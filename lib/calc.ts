// Pure calculations over LedgerData. No I/O here, so this can be reused
// unchanged once the data comes from Supabase.

import { bankOnlyExpenses } from "./recon";
import { CLINICS, type ClinicId, type ClinicOrShared, type LedgerData, type MonthKey, type PappyJoeMonth } from "./types";

/** MOCK RULE (to confirm with the doctor): Shared items are split 50/50. */
export const SHARED_SPLIT: Record<ClinicId, number> = { SDC1: 0.5, SDC2: 0.5 };

export const monthOf = (date: string): MonthKey => date.slice(0, 7);

/** Months that have any data, plus the current month so a new, empty database still has one to show. */
export function monthsIn(d: LedgerData): MonthKey[] {
  const now = new Date().toISOString().slice(0, 7);
  return [
    ...new Set([
      ...d.pappyJoe.map((p) => p.month),
      ...d.expenses.map((e) => monthOf(e.date)),
      ...d.bankDeposits.map((b) => monthOf(b.date)),
      ...d.bankTxns.map((t) => monthOf(t.date)),
      ...d.pjReceipts.map((r) => monthOf(r.date)),
      now,
    ]),
  ].sort();
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
