// Staff see their own clinic's petty cash balance and nothing else. The
// figures come from a read-only database function (my_petty_cash), because
// staff cannot read bank rows, transfers or counts themselves. The balance is
// worked out with the same code as the admin's Petty cash page, so they agree.

import { pettyCashMonth } from "./calc";
import { CLINICS, type ClinicId, type LedgerData, type MonthKey } from "./types";

export interface MyPettyCash {
  clinic: ClinicId;
  opening: number;
  transfers: { date: string; amount: number }[];
  /** PETTY CASH withdrawals in the bank statement (split between the clinics). */
  bank: { date: string; withdrawal: number }[];
  /** Expenses paid from this clinic's petty cash. */
  spent: { date: string; amount: number }[];
  counts: { month: MonthKey; counted: number }[];
}

export function staffPettyMonth(p: MyPettyCash, month: MonthKey) {
  const d = {
    pettyCashOpening: { SDC1: 0, SDC2: 0, [p.clinic]: p.opening },
    pettyCashTransfers: p.transfers.map((t, i) => ({ id: `t${i}`, date: t.date, clinic: p.clinic, amount: t.amount, note: "" })),
    bankTxns: p.bank.map((b, i) => ({ id: `b${i}`, date: b.date, kind: "PETTY_CASH", withdrawal: b.withdrawal, deposit: 0 })),
    expenses: p.spent.map((e, i) => ({ id: `e${i}`, date: e.date, amount: e.amount, paidBy: "PETTY_CASH", pettyCashClinic: p.clinic, category: "", clinic: p.clinic, note: "" })),
    pettyCounts: p.counts.map((c, i) => ({ id: `c${i}`, clinic: p.clinic, month: c.month, counted: c.counted, note: "", countedBy: "", countedAt: "" })),
  } as unknown as LedgerData;
  return pettyCashMonth(d, p.clinic, month);
}

/** From the function's JSON (numbers may arrive as strings). */
export function parseMyPettyCash(raw: unknown): MyPettyCash | undefined {
  const r = raw as Record<string, unknown> | null;
  if (!r || !CLINICS.includes(r.clinic as ClinicId)) return undefined;
  const list = (x: unknown) => (Array.isArray(x) ? (x as Record<string, unknown>[]) : []);
  const day = (x: unknown) => String(x).slice(0, 10);
  return {
    clinic: r.clinic as ClinicId,
    opening: Number(r.opening ?? 0),
    transfers: list(r.transfers).map((t) => ({ date: day(t.date), amount: Number(t.amount) })),
    bank: list(r.bank).map((b) => ({ date: day(b.date), withdrawal: Number(b.withdrawal) })),
    spent: list(r.spent).map((e) => ({ date: day(e.date), amount: Number(e.amount) })),
    counts: list(r.counts).map((c) => ({ month: String(c.month), counted: Number(c.counted) })),
  };
}
