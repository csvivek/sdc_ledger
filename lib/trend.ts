// Month-by-month figures for the dashboard charts. Pure functions, no I/O.

import { monthsWithData, pnl } from "./calc";
import { matches, reconcileMonth } from "./recon";
import type { LedgerData, MonthKey } from "./types";

/** Charts appear once there are MORE than this many months of data. Below it, only the tables show. */
export const CHART_THRESHOLD_MONTHS = 6;

/** The charts show at most this many of the latest months, so bars stay wide enough to tap on a phone. The table shows all. */
export const CHART_WINDOW_MONTHS = 12;

export function shouldShowCharts(monthsOfData: number): boolean {
  return monthsOfData > CHART_THRESHOLD_MONTHS;
}

export interface TrendRow {
  month: MonthKey;
  income: number;
  expenses: number;
  profit: { SDC1: number; SDC2: number; ALL: number };
  /** PappyJoe cash minus cash deposited in HDFC that month. */
  cashNotDeposited: number;
  /** PappyJoe UPI minus UPI credits in HDFC that month. */
  upiGap: number;
}

export function trendRows(d: LedgerData, months: MonthKey[] = monthsWithData(d)): TrendRow[] {
  const m = matches(d);
  return months.map((month) => {
    const all = pnl(d, month, "ALL");
    const r = reconcileMonth(d, month, m);
    return {
      month,
      income: all.income,
      expenses: all.expenses,
      profit: { SDC1: pnl(d, month, "SDC1").profit, SDC2: pnl(d, month, "SDC2").profit, ALL: all.profit },
      cashNotDeposited: r.cash.unexplained,
      upiGap: r.upi.pjTotal - r.upi.bank,
    };
  });
}

/** The months before `end` (inclusive), oldest first. */
export function monthsEndingAt(end: MonthKey, count: number): MonthKey[] {
  const [y, m] = end.split("-").map(Number);
  return Array.from({ length: count }, (_, i) => {
    const t = y * 12 + (m - 1) - (count - 1 - i);
    return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
  });
}

/**
 * SAMPLE NUMBERS for previewing the charts before there are 7 real months.
 * Invented, deterministic (same output every time), never stored.
 */
export function previewTrendRows(end: MonthKey, count = CHART_WINDOW_MONTHS): TrendRow[] {
  return monthsEndingAt(end, count).map((month, i) => {
    const wave = Math.sin(i * 0.9);
    const inc1 = Math.round((470000 + 30000 * wave + 4000 * i) / 500) * 500;
    const inc2 = Math.round((310000 + 22000 * Math.cos(i * 0.7) + 3000 * i) / 500) * 500;
    const exp1 = Math.round((330000 + 25000 * Math.cos(i * 1.3) + (i % 4 === 3 ? 60000 : 0)) / 500) * 500;
    const exp2 = Math.round((250000 + 20000 * Math.sin(i * 1.1) + (i === 5 ? 90000 : 0)) / 500) * 500;
    return {
      month,
      income: inc1 + inc2,
      expenses: exp1 + exp2,
      profit: { SDC1: inc1 - exp1, SDC2: inc2 - exp2, ALL: inc1 + inc2 - exp1 - exp2 },
      cashNotDeposited: [0, 6500, 0, 12000, 3000, 0, 22000, 9500, 0, 4000, 15500, 31500][i % 12],
      upiGap: [0, 1200, -800, 0, 2500, 0, 0, 3400, -1500, 0, 900, 1200][i % 12],
    };
  });
}

/** Short rupee amounts for chart axes, in lakh and crore: ₹4.5L, ₹85k, -₹12k. */
export function compactInr(n: number): string {
  const sign = n < 0 ? "-" : "";
  const a = Math.abs(n);
  const trim = (x: number) => (x >= 10 ? Math.round(x).toString() : (Math.round(x * 10) / 10).toString());
  if (a >= 1e7) return `${sign}₹${trim(a / 1e7)}Cr`;
  if (a >= 1e5) return `${sign}₹${trim(a / 1e5)}L`;
  if (a >= 1e3) return `${sign}₹${trim(a / 1e3)}k`;
  return `${sign}₹${Math.round(a)}`;
}

/** Round axis steps (1, 2 or 5 × 10^n) covering min..max, always including 0. */
export function niceTicks(min: number, max: number, target = 4): number[] {
  const lo = Math.min(0, min);
  const hi = Math.max(0, max);
  if (hi === lo) return [0];
  const raw = (hi - lo) / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 5, 10].find((f) => f * mag >= raw) ?? 10) * mag;
  const out: number[] = [];
  for (let v = Math.floor(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Math.round(v));
  if (out[out.length - 1] < hi) out.push(out[out.length - 1] + step);
  return out;
}

/** "Sep" plus the year on the first month and every January, for chart x labels. */
export function axisMonth(m: MonthKey, first: boolean): { month: string; year?: string } {
  const [y, mo] = m.split("-").map(Number);
  const month = new Date(y, mo - 1, 1).toLocaleDateString("en-IN", { month: "short" });
  return first || mo === 1 ? { month, year: String(y) } : { month };
}
