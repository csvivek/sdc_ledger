// Pure calculations over LedgerData. No I/O here, so this can be reused
// unchanged once the data comes from Supabase.

import { CLINICS, type ClinicId, type LedgerData, type MonthKey } from "./types";

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

export interface PnL {
  income: number;
  expenses: number;
  profit: number;
}

/** Income = all PappyJoe collections (cash + UPI + card). Expenses exclude petty cash transfers by design. */
export function pnl(d: LedgerData, month: MonthKey, clinic: ClinicId | "ALL"): PnL {
  const clinics = clinic === "ALL" ? CLINICS : [clinic];
  const income = d.pappyJoe
    .filter((p) => p.month === month && clinics.includes(p.clinic))
    .reduce((s, p) => s + p.cash + p.upi + p.card, 0);
  const expenses = d.expenses
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
  for (const e of d.expenses) {
    if (monthOf(e.date) !== month) continue;
    m.set(e.category, (m.get(e.category) ?? 0) + e.amount);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

export function pettyCash(d: LedgerData, clinic: ClinicId) {
  const transfersIn = d.pettyCashTransfers.filter((t) => t.clinic === clinic);
  const spent = d.expenses.filter((e) => e.paidBy === "PETTY_CASH" && e.pettyCashClinic === clinic);
  const totalIn = transfersIn.reduce((s, t) => s + t.amount, 0);
  const totalOut = spent.reduce((s, e) => s + e.amount, 0);
  const opening = d.pettyCashOpening[clinic];
  return { opening, totalIn, totalOut, balance: opening + totalIn - totalOut, transfersIn, spent };
}

export interface ReconRow {
  month: MonthKey;
  clinic: ClinicId;
  pjCash: number;
  pjUpi: number;
  bankCash: number;
  bankUpi: number;
  gap: number; // positive = less reached the bank than PappyJoe says
  reason: string;
}

export function reconciliation(d: LedgerData, month: MonthKey): ReconRow[] {
  return CLINICS.map((clinic) => {
    const pj = d.pappyJoe.find((p) => p.month === month && p.clinic === clinic);
    const deps = d.bankDeposits.filter((b) => monthOf(b.date) === month && b.clinic === clinic);
    const bankCash = deps.filter((b) => b.kind === "CASH").reduce((s, b) => s + b.amount, 0);
    const bankUpi = deps.filter((b) => b.kind === "UPI").reduce((s, b) => s + b.amount, 0);
    const pjCash = pj?.cash ?? 0;
    const pjUpi = pj?.upi ?? 0;
    const reason = d.reconReasons.find((r) => r.month === month && r.clinic === clinic)?.reason ?? "";
    return { month, clinic, pjCash, pjUpi, bankCash, bankUpi, gap: pjCash + pjUpi - bankCash - bankUpi, reason };
  });
}
