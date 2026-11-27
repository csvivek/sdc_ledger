// Who was paid the most: consultants, labs and pharma companies. Pure functions, no I/O.
//
// A payment counts here if its category asks for that kind of payee (Consultant, Lab, Pharma).
// Portal expenses name their payee directly. Bank payments nobody entered in the portal have no
// payee, so the beneficiary name is read from the HDFC narration and matched to the payee list;
// a name not in the list still shows, marked "from bank". Anything left is "Not assigned", so the
// totals always add up to the category totals.

import { monthOf, SHARED_SPLIT } from "./calc";
import { bankOnlyExpenses } from "./recon";
import { addMonths } from "./trend";
import type { BankTxn, ClinicId, ClinicOrShared, LedgerData, MonthKey, PayeeKind } from "./types";

export type ReportKind = Extract<PayeeKind, "consultant" | "lab" | "pharma">;
export const REPORT_KINDS: ReportKind[] = ["consultant", "lab", "pharma"];
export const REPORT_TITLE: Record<ReportKind, string> = { consultant: "Consultants", lab: "Labs", pharma: "Pharma companies" };

export type ReportPeriod = "month" | "12m" | "all";
export const PERIOD_LABEL: Record<ReportPeriod, string> = { month: "This month", "12m": "Last 12 months", all: "All time" };
export type ReportScope = ClinicId | "ALL";

export const NOT_ASSIGNED = "Not assigned";

export interface PayeeRankRow {
  name: string;
  /** "payee": from the payee list. "bank": a name read from the bank narration that is not in the list. "none": not assigned. */
  source: "payee" | "bank" | "none";
  payments: number;
  amount: number;
  /** Share of the group's total, 0..100. */
  share: number;
  lastPaid: string;
}

export interface PayeeRanking {
  kind: ReportKind;
  total: number;
  payments: number;
  rows: PayeeRankRow[];
}

/** Letters only, upper case, without a leading DR title: "Dr. Priyanka G" and "DR PRIYANKA G" both give "PRIYANKAG". */
export function normName(s: string): string {
  return s
    .toUpperCase()
    .replace(/[^A-Z ]/g, " ")
    .trim()
    .replace(/^DR\s+/, "")
    .replace(/\s+/g, "");
}

/**
 * The beneficiary's name in an HDFC debit narration, or null when it cannot be told.
 * "NEFT DR-IFSC-NAME-NETBANK, ..." and "IMPS-REF-NAME-..." and "UPI-NAME-VPA-..." are understood.
 * Only the name is returned, never the remarks (which can hold patient names).
 */
export function bankBeneficiary(narration: string): string | null {
  const parts = narration.split("-").map((p) => p.trim());
  const head = parts[0]?.toUpperCase() ?? "";
  let name: string | undefined;
  if (head.startsWith("NEFT") || head.startsWith("RTGS") || head.startsWith("IMPS")) name = parts[2];
  else if (head.startsWith("UPI")) name = parts[1];
  if (!name || !/[A-Za-z]{2}/.test(name)) return null;
  return name.replace(/\s+/g, " ");
}

const titleCase = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

/** First and last month of a period, or null for all time. */
export function periodMonths(period: ReportPeriod, month: MonthKey): { from: MonthKey; to: MonthKey } | null {
  if (period === "all") return null;
  return { from: period === "month" ? month : addMonths(month, -11), to: month };
}

interface Line {
  date: string;
  amount: number;
  clinic: ClinicOrShared;
  name: string;
  source: PayeeRankRow["source"];
}

function lines(d: LedgerData, kind: ReportKind): Line[] {
  const cats = new Set(Object.entries(d.categoryPayeeKind).filter(([, k]) => k === kind).map(([c]) => c));
  const payees = d.payees.filter((p) => p.kind === kind);
  const byId = new Map(d.payees.map((p) => [p.id, p]));
  const byName = new Map(payees.map((p) => [normName(p.name), p]));

  const fromPortal: Line[] = d.expenses
    .filter((e) => cats.has(e.category))
    .map((e) => {
      const p = e.payeeId ? byId.get(e.payeeId) : undefined;
      return { date: e.date, amount: e.amount, clinic: e.clinic, name: p?.name ?? NOT_ASSIGNED, source: p ? "payee" : "none" };
    });

  const fromBank: Line[] = bankOnlyExpenses(d)
    .filter((t: BankTxn) => t.category && cats.has(t.category))
    .map((t) => {
      const ben = bankBeneficiary(t.narration);
      const p = ben ? byName.get(normName(ben)) : undefined;
      const base = { date: t.date, amount: t.withdrawal, clinic: t.clinic ?? ("SHARED" as const) };
      if (p) return { ...base, name: p.name, source: "payee" as const };
      if (ben) return { ...base, name: titleCase(ben), source: "bank" as const };
      return { ...base, name: NOT_ASSIGNED, source: "none" as const };
    });

  return [...fromPortal, ...fromBank];
}

/**
 * Payees of one kind, most paid first, for a period and a clinic (or both).
 * Shared payments count fully for both clinics together and split 50/50 per clinic, as in the P&L.
 */
export function payeeRanking(d: LedgerData, kind: ReportKind, period: ReportPeriod, month: MonthKey, scope: ReportScope): PayeeRanking {
  const span = periodMonths(period, month);
  const out = new Map<string, PayeeRankRow>();
  for (const l of lines(d, kind)) {
    const m = monthOf(l.date);
    if (span && (m < span.from || m > span.to)) continue;
    const amount = scope === "ALL" ? l.amount : l.clinic === scope ? l.amount : l.clinic === "SHARED" ? l.amount * SHARED_SPLIT[scope] : 0;
    if (!amount) continue;
    const key = `${l.source === "none" ? "none" : "named"}|${normName(l.name) || l.name}`;
    const row = out.get(key) ?? { name: l.name, source: l.source, payments: 0, amount: 0, share: 0, lastPaid: l.date };
    row.payments += 1;
    row.amount += amount;
    if (l.date > row.lastPaid) row.lastPaid = l.date;
    // A list payee wins over the same name read from the bank.
    if (l.source === "payee") {
      row.source = "payee";
      row.name = l.name;
    }
    out.set(key, row);
  }
  const rows = [...out.values()];
  const total = rows.reduce((s, r) => s + r.amount, 0);
  for (const r of rows) r.share = total ? (r.amount / total) * 100 : 0;
  // Most paid first; "Not assigned" always last.
  rows.sort((a, b) => (a.source === "none" ? 1 : 0) - (b.source === "none" ? 1 : 0) || b.amount - a.amount || a.name.localeCompare(b.name));
  return { kind, total, payments: rows.reduce((s, r) => s + r.payments, 0), rows };
}

export function parsePeriod(v: string | undefined): ReportPeriod {
  return v === "month" || v === "all" ? v : "12m";
}

export function parseScope(v: string | undefined): ReportScope {
  return v === "SDC1" || v === "SDC2" ? v : "ALL";
}
