// Pure calculations over LedgerData. No I/O here, so this can be reused
// unchanged once the data comes from Supabase.

import { bankOnlyExpenses } from "./recon";
import { CLINICS, type ClinicId, type ClinicOrShared, type LedgerData, type MonthKey, type PappyJoeMonth } from "./types";

/** MOCK RULE (to confirm with the doctor): Shared items are split 50/50. */
export const SHARED_SPLIT: Record<ClinicId, number> = { SDC1: 0.5, SDC2: 0.5 };

export const monthOf = (date: string): MonthKey => date.slice(0, 7);

/** Months that hold at least one PappyJoe, expense or bank record, oldest first. */
export function monthsWithData(d: LedgerData): MonthKey[] {
  return [
    ...new Set([
      ...d.pappyJoe.map((p) => p.month),
      ...d.expenses.map((e) => monthOf(e.date)),
      ...d.bankDeposits.map((b) => monthOf(b.date)),
      ...d.bankTxns.map((t) => monthOf(t.date)),
      ...d.pjReceipts.map((r) => monthOf(r.date)),
    ]),
  ].sort();
}

/** Months that have any data, plus the current month so a new, empty database still has one to show. */
export function monthsIn(d: LedgerData): MonthKey[] {
  const now = new Date().toISOString().slice(0, 7);
  return [...new Set([...monthsWithData(d), now])].sort();
}

export function monthLabel(m: MonthKey) {
  const [y, mo] = m.split("-").map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
}

export function inr(n: number) {
  return "₹" + Math.round(n).toLocaleString("en-IN");
}

/**
 * PappyJoe income per clinic per month. Months with imported receipts use
 * them (negative lines included, as PappyJoe counts them); other months fall
 * back to totals typed in earlier (pappyjoe_income).
 */
export function pappyJoeMonths(d: LedgerData): PappyJoeMonth[] {
  const out = new Map<string, PappyJoeMonth>();
  for (const r of d.pjReceipts) {
    const k = `${monthOf(r.date)}|${r.clinic}`;
    const m = out.get(k) ?? { month: monthOf(r.date), clinic: r.clinic, cash: 0, upi: 0, card: 0 };
    if (r.mode === "CASH") m.cash += r.amount;
    else if (r.mode === "UPI") m.upi += r.amount;
    else if (r.mode === "CARD") m.card += r.amount;
    out.set(k, m);
  }
  for (const p of d.pappyJoe) if (!out.has(`${p.month}|${p.clinic}`)) out.set(`${p.month}|${p.clinic}`, p);
  return [...out.values()];
}

/** One expense line for the P&L: either entered in the portal, or a bank debit nobody entered. */
interface CostLine {
  date: string;
  amount: number;
  category: string;
  clinic: ClinicOrShared;
}

/** Portal expenses plus bank debits that have no matching portal entry, so nothing is missed or counted twice. */
export function allCosts(d: LedgerData): CostLine[] {
  return [
    ...d.expenses,
    ...bankOnlyExpenses(d).map((t) => ({ date: t.date, amount: t.withdrawal, category: t.category ?? "Miscellaneous", clinic: t.clinic ?? "SHARED" })),
  ];
}

export interface PnL {
  income: number;
  expenses: number;
  profit: number;
}

/**
 * Income = all PappyJoe collections (cash + UPI + card). Expenses = portal
 * entries + categorised bank debits not entered in the portal. Petty cash
 * transfers are not expenses. Bank debits still waiting for a category are
 * left out until the admin answers.
 */
export function pnl(d: LedgerData, month: MonthKey, clinic: ClinicId | "ALL"): PnL {
  const clinics = clinic === "ALL" ? CLINICS : [clinic];
  const income = pappyJoeMonths(d)
    .filter((p) => p.month === month && clinics.includes(p.clinic))
    .reduce((s, p) => s + p.cash + p.upi + p.card, 0);
  const expenses = allCosts(d)
    .filter((e) => monthOf(e.date) === month)
    .reduce((s, e) => {
      if (clinic === "ALL") return s + e.amount;
      if (e.clinic === clinic) return s + e.amount;
      if (e.clinic === "SHARED") return s + e.amount * SHARED_SPLIT[clinic];
      return s;
    }, 0);
  return { income, expenses, profit: income - expenses };
}

export function expensesByCategory(d: LedgerData, month: MonthKey) {
  const m = new Map<string, number>();
  for (const e of allCosts(d)) {
    if (monthOf(e.date) !== month) continue;
    m.set(e.category, (m.get(e.category) ?? 0) + e.amount);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

export function pettyCash(d: LedgerData, clinic: ClinicId) {
  // Bank transfers to the doctor marked PETTY CASH are split equally between
  // the clinics (7,000 = 3,500 each, per Vivek).
  const fromBank = d.bankTxns
    .filter((t) => t.kind === "PETTY_CASH")
    .map((t) => ({ id: t.id, date: t.date, clinic, amount: t.withdrawal / CLINICS.length, note: "From bank statement" }));
  const transfersIn = [...d.pettyCashTransfers.filter((t) => t.clinic === clinic), ...fromBank].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  const spent = d.expenses.filter((e) => e.paidBy === "PETTY_CASH" && e.pettyCashClinic === clinic);
  const totalIn = transfersIn.reduce((s, t) => s + t.amount, 0);
  const totalOut = spent.reduce((s, e) => s + e.amount, 0);
  const opening = d.pettyCashOpening[clinic];
  return { opening, totalIn, totalOut, balance: opening + totalIn - totalOut, transfersIn, spent };
}

/**
 * One clinic's petty cash for one month. Leftover cash stays in the clinic box,
 * so a month starts with what the month before ended with:
 * - the cash counted at the end of the latest earlier month that was counted,
 *   plus what came in and went out after it, or
 * - with no earlier count, the opening amount plus everything before.
 * The month then ends on its own count if there is one, otherwise on the
 * expected balance. The Reconcile page uses this too, so both pages agree.
 */
export function pettyCashMonth(d: LedgerData, clinic: ClinicId, month: MonthKey) {
  const all = pettyCash(d, clinic);
  const counts = (d.pettyCounts ?? []).filter((c) => c.clinic === clinic);
  const lastCount = counts.filter((c) => c.month < month).sort((a, b) => a.month.localeCompare(b.month)).pop();
  const after = lastCount?.month ?? "";
  const between = (date: string) => monthOf(date) > after && monthOf(date) < month;
  const inMonth = (date: string) => monthOf(date) === month;
  const sumOf = (xs: { amount: number }[]) => xs.reduce((s, x) => s + x.amount, 0);

  const transfersIn = all.transfersIn.filter((t) => inMonth(t.date));
  const spent = all.spent.filter((e) => inMonth(e.date));
  const carriedIn =
    (lastCount ? lastCount.counted : all.opening) +
    sumOf(all.transfersIn.filter((t) => between(t.date))) -
    sumOf(all.spent.filter((e) => between(e.date)));
  const received = sumOf(transfersIn);
  const spentTotal = sumOf(spent);
  const expected = carriedIn + received - spentTotal;
  const count = counts.find((c) => c.month === month);
  return {
    carriedIn,
    received,
    spent: spentTotal,
    /** What should be in the box at month end, from the movements. */
    expected,
    count,
    /** Counted minus expected: positive = more cash than expected. 0 when not counted. */
    difference: count ? count.counted - expected : 0,
    /** What the next month starts with: the count if there is one. */
    leftAtEnd: count ? count.counted : expected,
    transfersIn,
    spentList: spent,
  };
}

/** All time, with every month-end count difference added as an adjustment. */
export function pettyCashAllTime(d: LedgerData, clinic: ClinicId) {
  const all = pettyCash(d, clinic);
  const adjustments = (d.pettyCounts ?? [])
    .filter((c) => c.clinic === clinic)
    .map((c) => ({ count: c, difference: pettyCashMonth(d, clinic, c.month).difference }));
  const adjusted = adjustments.reduce((s, a) => s + a.difference, 0);
  return { ...all, adjustments, adjusted, balance: all.balance + adjusted };
}

/** Today's date in India (YYYY-MM-DD). The server runs in UTC, the clinics in IST. */
export function todayInIndia(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);
}

const dayMs = 86400000;
const utcDay = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));

/** Last day of the payment's month (YYYY-MM-DD): card income must be in the clinic account by then. */
export function cardDueDate(paymentDate: string): string {
  const y = +paymentDate.slice(0, 4);
  const m = +paymentDate.slice(5, 7);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** Days past the due date (positive = overdue), or days left until it (negative or zero). */
export function cardDaysOverdue(paymentDate: string, today: string): number {
  return Math.round((utcDay(today) - utcDay(cardDueDate(paymentDate))) / dayMs);
}
