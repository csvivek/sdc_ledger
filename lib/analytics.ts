// Patient and payment analytics from the PappyJoe "Payments" import. Pure functions, no I/O.
// Only counts and totals come out of here: never patient names, ids or phone numbers.

import { monthOf } from "./calc";
import { monthsEndingAt, PREVIEW_MONTHS } from "./trend";
import type { ClinicId, MonthKey, PayMode, PjReceipt } from "./types";

export type Scope = ClinicId | "ALL";
export const SCOPES: Scope[] = ["SDC1", "SDC2", "ALL"];
export const MODES: PayMode[] = ["CASH", "UPI", "CARD", "OTHER"];
export const MODE_LABEL: Record<PayMode, string> = { CASH: "Cash", UPI: "UPI", CARD: "Card", OTHER: "Other" };

export interface ModeTotals {
  /** Payments in this mode (positive lines only). */
  count: number;
  /** Net amount in this mode, corrections included, so it agrees with Income on the dashboard. */
  amount: number;
}

export interface AnalyticsRow {
  month: MonthKey;
  scope: Scope;
  /** Distinct patients who paid something this month. */
  patients: number;
  /** One patient paying on one day. Visits without a payment are not in the PappyJoe export. */
  visits: number;
  /** Days with at least one payment. */
  openDays: number;
  payments: number;
  /** Net revenue: every payment line, negative corrections included. */
  revenue: number;
  /** Negative PappyJoe lines (reversals or corrections), as a negative number. */
  corrections: number;
  correctionLines: number;
  perPatient: number;
  perVisit: number;
  visitsPerDay: number;
  modes: Record<PayMode, ModeTotals>;
}

const emptyModes = (): Record<PayMode, ModeTotals> => ({
  CASH: { count: 0, amount: 0 },
  UPI: { count: 0, amount: 0 },
  CARD: { count: 0, amount: 0 },
  OTHER: { count: 0, amount: 0 },
});

/** Months that have imported PappyJoe payments, oldest first. */
export function receiptMonths(receipts: PjReceipt[]): MonthKey[] {
  return [...new Set(receipts.map((r) => monthOf(r.date)))].sort();
}

const div = (a: number, b: number) => (b ? a / b : 0);

/** One row per month per scope (SDC1, SDC2, ALL), oldest month first. */
export function analyticsRows(receipts: PjReceipt[], months: MonthKey[] = receiptMonths(receipts)): AnalyticsRow[] {
  return months.flatMap((month) => {
    const inMonth = receipts.filter((r) => monthOf(r.date) === month);
    return SCOPES.map((scope) => {
      const rs = scope === "ALL" ? inMonth : inMonth.filter((r) => r.clinic === scope);
      const paid = rs.filter((r) => r.amount > 0);
      // Patient ids are per clinic in PappyJoe, so the clinic is part of the key.
      const patients = new Set(paid.map((r) => `${r.clinic}|${r.patientId}`)).size;
      const visits = new Set(paid.map((r) => `${r.clinic}|${r.patientId}|${r.date}`)).size;
      const openDays = new Set(paid.map((r) => r.date)).size;
      const modes = emptyModes();
      for (const r of rs) {
        const m = modes[r.mode] ?? modes.OTHER;
        m.amount += r.amount;
        if (r.amount > 0) m.count += 1;
      }
      const neg = rs.filter((r) => r.amount < 0);
      const revenue = rs.reduce((s, r) => s + r.amount, 0);
      return {
        month,
        scope,
        patients,
        visits,
        openDays,
        payments: paid.length,
        revenue,
        corrections: neg.reduce((s, r) => s + r.amount, 0),
        correctionLines: neg.length,
        perPatient: div(revenue, patients),
        perVisit: div(revenue, visits),
        visitsPerDay: div(visits, openDays),
        modes,
      };
    });
  });
}

/** Share of a row's money (or payments) in one mode, 0..100. */
export function modeShare(row: AnalyticsRow, mode: PayMode, by: "amount" | "count"): number {
  const total = MODES.reduce((s, m) => s + row.modes[m][by], 0);
  return div(row.modes[mode][by], total) * 100;
}

export interface CardQuote {
  /** Bank's charge per card payment, in percent (e.g. 1.5). */
  ratePct: number;
  /** Fixed monthly rent for the machine, in rupees. */
  monthlyRent: number;
}

/**
 * Reads the bank quote typed on the dashboard. Both boxes must hold a number of 0 or more;
 * otherwise there is no quote and no cost is shown. Nothing is assumed.
 */
export function parseQuote(rate: string, rent: string): CardQuote | null {
  const r = rate.trim();
  const m = rent.trim();
  if (r === "" || m === "") return null;
  const ratePct = Number(r);
  const monthlyRent = Number(m);
  if (!Number.isFinite(ratePct) || !Number.isFinite(monthlyRent) || ratePct < 0 || monthlyRent < 0 || ratePct > 100) return null;
  return { ratePct, monthlyRent };
}

/** What the machine would cost in a month with this much card money. */
export function cardCost(cardVolume: number, q: CardQuote): number {
  return (Math.max(0, cardVolume) * q.ratePct) / 100 + q.monthlyRent;
}

/** Cost as a share of the card money, 0..100. Null when there was no card money. */
export function cardCostShare(cardVolume: number, q: CardQuote): number | null {
  return cardVolume > 0 ? (cardCost(cardVolume, q) / cardVolume) * 100 : null;
}

/**
 * SAMPLE ROWS for previewing the analytics charts before there are 7 real months.
 * Invented, deterministic, never stored.
 */
export function previewAnalyticsRows(end: MonthKey, count = PREVIEW_MONTHS): AnalyticsRow[] {
  return monthsEndingAt(end, count).flatMap((month, i) => {
    const mk = (pts: number, perPt: number, cashPct: number, card: number): Omit<AnalyticsRow, "month" | "scope"> => {
      const visits = Math.round(pts * 1.4);
      const revenue = Math.round((pts * perPt) / 100) * 100;
      const cash = Math.round((revenue - card) * cashPct);
      const modes = emptyModes();
      modes.CASH = { count: Math.round(visits * cashPct), amount: cash };
      modes.UPI = { count: visits - Math.round(visits * cashPct) - (card ? 1 : 0), amount: revenue - card - cash };
      modes.CARD = { count: card ? 1 + (i % 3) : 0, amount: card };
      return { patients: pts, visits, openDays: 24, payments: visits, revenue, corrections: 0, correctionLines: 0, perPatient: revenue / pts, perVisit: revenue / visits, visitsPerDay: visits / 24, modes };
    };
    const a = mk(80 + Math.round(8 * Math.sin(i)), 2300 + 150 * Math.cos(i * 0.8), 0.45, [0, 0, 3500, 0, 8000, 0, 0, 4700, 12000, 0, 6000, 2500][i % 12]);
    const b = mk(38 + Math.round(5 * Math.cos(i * 0.6)), 2500 + 200 * Math.sin(i * 0.5), 0.22, [4700, 0, 0, 9000, 0, 2000, 15000, 0, 0, 5500, 0, 7000][i % 12]);
    const all = { ...a, patients: a.patients + b.patients, visits: a.visits + b.visits, payments: a.payments + b.payments, revenue: a.revenue + b.revenue, openDays: 26, modes: emptyModes() };
    for (const m of MODES) all.modes[m] = { count: a.modes[m].count + b.modes[m].count, amount: a.modes[m].amount + b.modes[m].amount };
    all.perPatient = all.revenue / all.patients;
    all.perVisit = all.revenue / all.visits;
    all.visitsPerDay = all.visits / all.openDays;
    return [
      { month, scope: "SDC1" as const, ...a },
      { month, scope: "SDC2" as const, ...b },
      { month, scope: "ALL" as const, ...all },
    ];
  });
}
