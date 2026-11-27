// The accountant's workbook: the books for a month or a range of months, for
// one clinic or both. Pure functions, no I/O: the download route turns these
// sheets into an Excel file, and the print page shows the summary parts.
//
// Every figure comes from the same calculations the app's own pages use
// (pnl, matches, reconcileMonth), so the export always agrees with the
// dashboard and the Reconcile page.

import { allCosts, monthLabel, monthOf, pnl, SHARED_SPLIT } from "./calc";
import { matches, reconcileMonth } from "./recon";
import { shiftMonth } from "./expense-view";
import type { GapAnswerInfo, PettyCountInfo } from "./admin-types";
import { BANK_KIND_LABEL, CLINIC_LABEL, CLINICS, PAID_BY_LABEL, type ClinicId, type ClinicOrShared, type LedgerData, type MonthKey } from "./types";

export type Scope = ClinicId | "ALL";

export const SCOPE_LABEL: Record<Scope, string> = { SDC1: CLINIC_LABEL.SDC1, SDC2: CLINIC_LABEL.SDC2, ALL: "Both clinics combined" };

/** Longest range one export covers, so a file stays a sensible size. */
export const MAX_EXPORT_MONTHS = 24;

export interface ExportOptions {
  from: MonthKey;
  to: MonthKey;
  scope: Scope;
}

/** Extra answers from features whose tables may not exist yet (PR #15 gap answers, PR #16 petty counts). */
export interface ExportExtras {
  gapAnswers?: GapAnswerInfo[];
  pettyCounts?: PettyCountInfo[];
  /** Who made the file and when, for the title rows. */
  madeBy?: string;
  madeAt?: Date;
}

export type Cell = string | number | null;
export interface Sheet {
  name: string;
  rows: Cell[][];
  /** Index of the header row (bold, frozen). */
  header?: number;
}

/** Every month from..to inclusive, oldest first. Empty when from is after to. */
export function monthsBetween(from: MonthKey, to: MonthKey): MonthKey[] {
  const out: MonthKey[] = [];
  for (let m = from; m <= to && out.length <= MAX_EXPORT_MONTHS * 10; m = shiftMonth(m, 1)) out.push(m);
  return out;
}

/** How much of a line belongs to the scope: all of it, half of a shared one, or none. */
export function shareFor(clinic: ClinicOrShared, scope: Scope): number {
  if (scope === "ALL" || clinic === scope) return 1;
  if (clinic === "SHARED") return SHARED_SPLIT[scope];
  return 0;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const clinicsIn = (scope: Scope): ClinicId[] => (scope === "ALL" ? CLINICS : [scope]);

export function validateRange(from: string | undefined, to: string | undefined): { ok: true; from: MonthKey; to: MonthKey } | { ok: false; error: string } {
  const re = /^\d{4}-(0[1-9]|1[0-2])$/;
  if (!from || !to || !re.test(from) || !re.test(to)) return { ok: false, error: "Pick a start and end month." };
  if (from > to) return { ok: false, error: "The start month is after the end month." };
  if (monthsBetween(from, to).length > MAX_EXPORT_MONTHS) return { ok: false, error: `Please pick at most ${MAX_EXPORT_MONTHS} months at a time.` };
  return { ok: true, from, to };
}

/** Indian financial year (April to March) holding the month. */
export function financialYear(m: MonthKey): { from: MonthKey; to: MonthKey } {
  const [y, mo] = m.split("-").map(Number);
  const start = mo >= 4 ? y : y - 1;
  return { from: `${start}-04`, to: `${start + 1}-03` };
}

export function periodLabel(o: ExportOptions): string {
  return o.from === o.to ? monthLabel(o.from) : `${monthLabel(o.from)} to ${monthLabel(o.to)}`;
}

export function exportFileName(o: ExportOptions): string {
  const scope = o.scope === "ALL" ? "both-clinics" : o.scope.toLowerCase();
  return `sdc-books-${scope}-${o.from}${o.from === o.to ? "" : `-to-${o.to}`}.xlsx`;
}

export interface SummaryRow {
  month: MonthKey;
  cash: number;
  upi: number;
  card: number;
  /** PappyJoe lines with another mode; listed but, as on the dashboard, not counted in income. */
  other: number;
  income: number;
  expenses: number;
  profit: number;
}

export function summaryRows(d: LedgerData, o: ExportOptions): SummaryRow[] {
  const clinics = clinicsIn(o.scope);
  return monthsBetween(o.from, o.to).map((month) => {
    const rec = d.pjReceipts.filter((r) => monthOf(r.date) === month && clinics.includes(r.clinic));
    const typed = d.pappyJoe.filter((p) => p.month === month && clinics.includes(p.clinic));
    const fromReceipts = (mode: string) => rec.filter((r) => r.mode === mode).reduce((s, r) => s + r.amount, 0);
    // Same rule as pappyJoeMonths: imported receipts win; typed totals fill months without them.
    const typedFor = (k: "cash" | "upi" | "card") =>
      typed.filter((p) => !rec.some((r) => r.clinic === p.clinic)).reduce((s, p) => s + p[k], 0);
    const p = pnl(d, month, o.scope);
    return {
      month,
      cash: round2(fromReceipts("CASH") + typedFor("cash")),
      upi: round2(fromReceipts("UPI") + typedFor("upi")),
      card: round2(fromReceipts("CARD") + typedFor("card")),
      other: round2(fromReceipts("OTHER")),
      income: round2(p.income),
      expenses: round2(p.expenses),
      profit: round2(p.profit),
    };
  });
}

/** Expense per category per month for the scope (shared items split as on the dashboard). */
export function categoryTable(d: LedgerData, o: ExportOptions): { months: MonthKey[]; rows: { category: string; values: number[]; total: number }[] } {
  const months = monthsBetween(o.from, o.to);
  const idx = new Map(months.map((m, i) => [m, i]));
  const by = new Map<string, number[]>();
  for (const c of allCosts(d)) {
    const i = idx.get(monthOf(c.date));
    const share = shareFor(c.clinic, o.scope);
    if (i === undefined || !share) continue;
    const v = by.get(c.category) ?? months.map(() => 0);
    v[i] += c.amount * share;
    by.set(c.category, v);
  }
  const rows = [...by.entries()]
    .map(([category, values]) => ({ category, values: values.map(round2), total: round2(values.reduce((s, x) => s + x, 0)) }))
    .sort((a, b) => b.total - a.total);
  return { months, rows };
}

export interface ExpenseLine {
  date: string;
  clinic: ClinicOrShared;
  category: string;
  payee: string;
  invoiceNo: string;
  paidBy: string;
  amount: number;
  /** The part of it that belongs to the chosen clinic (half of a shared one). */
  share: number;
  source: "Entered in app" | "Bank only (not entered in app)";
  bankStatus: "Matched to bank" | "Not found in bank" | "Not a bank payment" | "From bank";
  bankDate: string;
  bankNarration: string;
  note: string;
  enteredBy: string;
}

export function expenseLines(d: LedgerData, o: ExportOptions): ExpenseLine[] {
  const m = matches(d);
  const months = new Set(monthsBetween(o.from, o.to));
  const payee = new Map(d.payees.map((p) => [p.id, p.name]));
  const people = new Map(d.users.map((u) => [u.id, u.name]));
  const bankFor = new Map(m.expense.map((x) => [x.expense.id, x.txn]));
  const out: ExpenseLine[] = [];
  for (const e of d.expenses) {
    const share = shareFor(e.clinic, o.scope);
    if (!months.has(monthOf(e.date)) || !share) continue;
    const t = bankFor.get(e.id);
    const viaBank = e.paidBy === "BANK" || e.paidBy === "UPI";
    out.push({
      date: e.date,
      clinic: e.clinic,
      category: e.category,
      payee: e.payeeId ? (payee.get(e.payeeId) ?? "") : "",
      invoiceNo: e.invoiceNo ?? "",
      paidBy: PAID_BY_LABEL[e.paidBy] + (e.paidBy === "PETTY_CASH" && e.pettyCashClinic ? ` (${e.pettyCashClinic})` : ""),
      amount: e.amount,
      share: round2(e.amount * share),
      source: "Entered in app",
      bankStatus: !viaBank ? "Not a bank payment" : t ? "Matched to bank" : "Not found in bank",
      bankDate: t?.date ?? "",
      bankNarration: t?.narration ?? "",
      note: e.note,
      enteredBy: people.get(e.enteredBy) ?? "",
    });
  }
  for (const t of d.bankTxns) {
    if (t.kind !== "EXPENSE" || m.debitMatched.has(t.id) || !months.has(monthOf(t.date))) continue;
    const clinic = t.clinic ?? "SHARED";
    const share = shareFor(clinic, o.scope);
    if (!share) continue;
    out.push({
      date: t.date,
      clinic,
      category: t.category ?? "Miscellaneous",
      payee: "",
      invoiceNo: "",
      paidBy: "Bank",
      amount: t.withdrawal,
      share: round2(t.withdrawal * share),
      source: "Bank only (not entered in app)",
      bankStatus: "From bank",
      bankDate: t.date,
      bankNarration: t.narration,
      note: "",
      enteredBy: "",
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.category.localeCompare(b.category));
}

export interface IncomeRow {
  month: MonthKey;
  clinic: ClinicId;
  cash: number;
  upi: number;
  card: number;
  other: number;
  total: number;
  receipts: number;
}

export function incomeRows(d: LedgerData, o: ExportOptions): IncomeRow[] {
  const out: IncomeRow[] = [];
  for (const month of monthsBetween(o.from, o.to))
    for (const clinic of clinicsIn(o.scope)) {
      const s = summaryRows(d, { from: month, to: month, scope: clinic })[0];
      const receipts = d.pjReceipts.filter((r) => r.clinic === clinic && monthOf(r.date) === month).length;
      out.push({ month, clinic, cash: s.cash, upi: s.upi, card: s.card, other: s.other, total: s.income, receipts });
    }
  return out;
}

export interface PettyRow {
  month: MonthKey;
  clinic: ClinicId;
  opening: number;
  received: number;
  spent: number;
  expected: number;
  counted: number | null;
  difference: number | null;
  reason: string;
}

export function pettyRows(d: LedgerData, o: ExportOptions, counts?: PettyCountInfo[]): PettyRow[] {
  const m = matches(d);
  const out: PettyRow[] = [];
  for (const month of monthsBetween(o.from, o.to)) {
    const r = reconcileMonth(d, month, m);
    for (const clinic of clinicsIn(o.scope)) {
      const p = r.petty[clinic];
      const c = counts?.find((x) => x.clinic === clinic && x.month === month);
      out.push({
        month,
        clinic,
        opening: round2(p.opening),
        received: round2(p.received),
        spent: round2(p.spent),
        expected: round2(p.closing),
        counted: c ? c.counted : null,
        difference: c ? round2(c.counted - p.closing) : null,
        reason: c ? [c.reason, c.note].filter(Boolean).join(" · ") : "",
      });
    }
  }
  return out;
}

export interface GapRow {
  month: MonthKey;
  type: string;
  date: string;
  clinic: string;
  amount: number;
  details: string;
  answer: string;
  followUp: string;
}

const GAP_TYPE_LABEL: Record<string, string> = {
  UPI_BANK_ONLY: "Bank UPI not in PappyJoe",
  UPI_PJ_ONLY: "PappyJoe UPI not in bank",
  OTHER_CREDIT: "Other money received",
  PORTAL_ONLY: "App expense not in bank",
  PJ_NEGATIVE: "Negative PappyJoe line",
  CASH_GAP: "Cash collected vs deposited",
  UNKNOWN_OUT: "Bank payment without a category",
};

/**
 * Every reconciliation gap in the range, with the answer given for it. Answers
 * come from gap_answers when that table exists (PR #15); notes and reasons
 * typed on the Reconcile page are always included.
 */
export function gapRows(d: LedgerData, o: ExportOptions, answers?: GapAnswerInfo[]): GapRow[] {
  const m = matches(d);
  const clinics = clinicsIn(o.scope);
  const answer = (type: string, key: string) => answers?.find((a) => a.gapType === type && a.itemKey === key);
  const said = (type: string, key: string) => {
    const a = answer(type, key);
    return a ? { answer: [a.label, a.note].filter(Boolean).join(" · "), followUp: a.followUp ? (a.todo ?? "Yes") : "" } : { answer: "", followUp: "" };
  };
  const out: GapRow[] = [];
  for (const month of monthsBetween(o.from, o.to)) {
    const r = reconcileMonth(d, month, m);
    const note = (topic: string) => d.reconNotes.find((n) => n.month === month && n.topic === topic)?.note ?? "";
    const withNote = (a: { answer: string; followUp: string }, topic: string) => (a.answer ? a : { ...a, answer: note(topic) });
    for (const t of r.upi.bankOnly)
      out.push({ month, type: GAP_TYPE_LABEL.UPI_BANK_ONLY, date: t.date, clinic: "Bank (both clinics)", amount: t.deposit, details: t.narration, ...withNote(said("UPI_BANK_ONLY", t.id), "UPI") });
    for (const x of r.upi.pjOnly) {
      if (!clinics.includes(x.clinic)) continue;
      const type = x.amount < 0 ? "PJ_NEGATIVE" : "UPI_PJ_ONLY";
      if (type === "PJ_NEGATIVE") continue; // listed with the negative lines below
      out.push({ month, type: GAP_TYPE_LABEL[type], date: x.date, clinic: x.clinic, amount: x.amount, details: `${x.patientName} · receipt ${x.receiptNo}`, ...withNote(said(type, x.id), "UPI") });
    }
    for (const t of r.expenses.otherCredits)
      out.push({ month, type: GAP_TYPE_LABEL.OTHER_CREDIT, date: t.date, clinic: "Bank (both clinics)", amount: t.deposit, details: t.narration, ...said("OTHER_CREDIT", t.id) });
    for (const e of r.expenses.portalOnly) {
      if (!shareFor(e.clinic, o.scope)) continue;
      out.push({ month, type: GAP_TYPE_LABEL.PORTAL_ONLY, date: e.date, clinic: e.clinic, amount: e.amount, details: `${e.category}${e.note ? ` · ${e.note}` : ""}`, ...withNote(said("PORTAL_ONLY", e.id), "EXPENSES") });
    }
    for (const t of r.expenses.unknown)
      out.push({ month, type: GAP_TYPE_LABEL.UNKNOWN_OUT, date: t.date, clinic: "Bank (both clinics)", amount: t.withdrawal, details: t.narration, answer: "", followUp: "Pick a category on Import" });
    for (const x of r.reversals) {
      if (!clinics.includes(x.clinic)) continue;
      out.push({ month, type: GAP_TYPE_LABEL.PJ_NEGATIVE, date: x.date, clinic: x.clinic, amount: x.amount, details: `${x.patientName} · receipt ${x.receiptNo} · ${x.paymentInfo || x.mode}`, ...said("PJ_NEGATIVE", x.id) });
    }
    if (r.hasBank && Math.round(r.cash.unexplained) !== 0) {
      const a = said("CASH_GAP", month);
      const typed = clinics.map((c) => d.reconReasons.find((x) => x.month === month && x.clinic === c)?.reason).filter(Boolean).join(" · ");
      out.push({
        month,
        type: GAP_TYPE_LABEL.CASH_GAP,
        date: "",
        clinic: "Both clinics (one bank account)",
        amount: round2(r.cash.unexplained),
        details: `PappyJoe cash ${round2(r.cash.pjTotal)} − deposited ${round2(r.cash.deposited)}`,
        answer: a.answer || [note("CASH"), typed].filter(Boolean).join(" · "),
        followUp: a.followUp,
      });
    }
  }
  return out;
}

const n = (v: number | null) => (v === null ? null : round2(v));

/** All sheets of the accountant's workbook. */
export function accountantSheets(d: LedgerData, o: ExportOptions, x: ExportExtras = {}): Sheet[] {
  const title = (name: string): Cell[][] => [
    [`Sarada Dental Care: ${name}`],
    [`${SCOPE_LABEL[o.scope]} · ${periodLabel(o)}`],
    [`Made by SDC Ledger${x.madeBy ? ` for ${x.madeBy}` : ""} on ${(x.madeAt ?? new Date()).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })}`],
    [],
  ];

  const sum = summaryRows(d, o);
  const tot = (k: keyof Omit<SummaryRow, "month">) => round2(sum.reduce((s, r) => s + r[k], 0));
  const summary: Sheet = {
    name: "Summary",
    header: 4,
    rows: [
      ...title("profit and loss"),
      ["Month", "Cash", "UPI", "Card", "Total income", "Expenses", "Profit", "Other mode (not in income)"],
      ...sum.map((r) => [monthLabel(r.month), r.cash, r.upi, r.card, r.income, r.expenses, r.profit, r.other]),
      ["Total", tot("cash"), tot("upi"), tot("card"), tot("income"), tot("expenses"), tot("profit"), tot("other")],
      [],
      ["Income is PappyJoe cash + UPI + card. Expenses are app entries plus categorised bank payments nobody entered in the app."],
      ["Petty cash withdrawals are transfers, not expenses. Bank payments still waiting for a category are left out."],
      [o.scope === "ALL" ? "Both clinics together." : `Shared expenses are split ${SHARED_SPLIT.SDC1 * 100}/${SHARED_SPLIT.SDC2 * 100} between the clinics (rule to confirm with the doctor).`],
    ],
  };

  const cat = categoryTable(d, o);
  const categories: Sheet = {
    name: "Expenses by category",
    header: 4,
    rows: [
      ...title("expenses by category"),
      ["Category", ...cat.months.map(monthLabel), "Total"],
      ...cat.rows.map((r) => [r.category, ...r.values, r.total]),
      ["Total", ...cat.months.map((_, i) => round2(cat.rows.reduce((s, r) => s + r.values[i], 0))), round2(cat.rows.reduce((s, r) => s + r.total, 0))],
    ],
  };

  const lines = expenseLines(d, o);
  const expenses: Sheet = {
    name: "Expenses",
    header: 4,
    rows: [
      ...title("every expense"),
      ["Date", "Clinic", "Category", "Paid to", "Invoice no.", "Paid by", "Amount", o.scope === "ALL" ? "Amount" : `Part for ${o.scope}`, "Where it came from", "Bank check", "Bank date", "Bank narration", "Note", "Entered by"],
      ...lines.map((l) => [l.date, l.clinic, l.category, l.payee, l.invoiceNo, l.paidBy, l.amount, l.share, l.source, l.bankStatus, l.bankDate, l.bankNarration, l.note, l.enteredBy]),
      ["Total", "", "", "", "", "", round2(lines.reduce((s, l) => s + l.amount, 0)), round2(lines.reduce((s, l) => s + l.share, 0))],
    ],
  };

  const inc = incomeRows(d, o);
  const income: Sheet = {
    name: "Income by mode",
    header: 4,
    rows: [
      ...title("income from PappyJoe by payment mode"),
      ["Month", "Clinic", "Cash", "UPI", "Card", "Total income", "Other mode (not in income)", "PappyJoe lines"],
      ...inc.map((r) => [monthLabel(r.month), r.clinic, r.cash, r.upi, r.card, r.total, r.other, r.receipts]),
    ],
  };

  const petty = pettyRows(d, o, x.pettyCounts);
  const pettySheet: Sheet = {
    name: "Petty cash",
    header: 4,
    rows: [
      ...title("petty cash per clinic"),
      ["Month", "Clinic", "Opening", "Received", "Spent", "Expected at month end", "Counted", "Difference", "Reason"],
      ...petty.map((r) => [monthLabel(r.month), r.clinic, r.opening, r.received, r.spent, r.expected, n(r.counted), n(r.difference), r.reason]),
      [],
      [x.pettyCounts ? "Counted = the month-end count typed on the Petty cash page." : "Month-end counts are not switched on yet, so only the expected balance is shown."],
    ],
  };

  const gaps = gapRows(d, o, x.gapAnswers);
  const gapSheet: Sheet = {
    name: "Reconciliation gaps",
    header: 4,
    rows: [
      ...title("reconciliation gaps and reasons"),
      ["Month", "Gap", "Date", "Clinic", "Amount", "Details", "Reason given", "Still to do"],
      ...gaps.map((g) => [monthLabel(g.month), g.type, g.date, g.clinic, g.amount, g.details, g.answer, g.followUp]),
      [],
      [gaps.length ? `${gaps.filter((g) => !g.answer).length} of ${gaps.length} gaps have no reason yet.` : "No gaps in this period."],
    ],
  };

  const months = new Set(monthsBetween(o.from, o.to));
  const m = matches(d);
  const bank: Sheet = {
    name: "Bank statement",
    header: 4,
    rows: [
      ...title("HDFC statement rows (one account for both clinics)"),
      ["Date", "Narration", "Ref no.", "Withdrawal", "Deposit", "Balance", "What it is", "Category", "Clinic", "Matched to an app entry"],
      ...d.bankTxns
        .filter((t) => months.has(monthOf(t.date)))
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((t) => [
          t.date,
          t.narration,
          t.refNo,
          t.withdrawal || null,
          t.deposit || null,
          t.balance,
          BANK_KIND_LABEL[t.kind],
          t.category ?? "",
          t.clinic ?? "",
          t.withdrawal > 0 ? (m.debitMatched.has(t.id) ? "Yes" : "No") : "",
        ]),
    ],
  };

  return [summary, categories, expenses, income, pettySheet, gapSheet, bank];
}
