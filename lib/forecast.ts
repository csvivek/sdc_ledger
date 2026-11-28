// Forecast: expected income and expenses for the next few months, worked out
// from the months already in the ledger. Pure functions, no I/O.
//
// How it estimates (kept simple on purpose, so it can be explained):
//   * Only finished months count: the current month is still running, and a
//     month is used only when PappyJoe income is in for that clinic (otherwise
//     a half-imported month would drag the estimate down).
//   * The estimate is an average of the latest finished months (up to 6),
//     with recent months weighted more (the latest counts 6x, the oldest 1x).
//   * With 6 or more months, the trend over those months is added too.
//   * The range shown is the lowest and highest month used.
// With fewer than 6 months it is clearly labelled as unreliable.

import { monthOf, pnl } from "./calc";
import { addMonths } from "./trend";
import { CLINICS, type ClinicId, type LedgerData, type MonthKey } from "./types";

/** Below this many finished months the forecast is labelled unreliable. */
export const RELIABLE_MONTHS = 6;
/** How many past months the estimate looks at, at most. */
export const LOOKBACK_MONTHS = 6;
/** Months ahead after the current one. The current month (still running) is estimated too. */
export const FORECAST_MONTHS = 3;

export type ForecastScope = ClinicId | "ALL";

export interface Estimate {
  value: number;
  low: number;
  high: number;
}

export interface ForecastMonth {
  month: MonthKey;
  income: Estimate;
  expenses: Estimate;
  /** income − expenses for the estimate; low/high pair the worst and best cases. */
  profit: Estimate;
}

export interface Forecast {
  scope: ForecastScope;
  /** The finished months the estimate is based on, oldest first. */
  basedOn: MonthKey[];
  reliable: boolean;
  /** True when the trend over the months was used (6 or more months). */
  trend: boolean;
  months: ForecastMonth[];
}

const round = (n: number) => Math.round(n / 100) * 100;

/**
 * Estimates the next `ahead` values of a series (oldest first).
 * Returns an empty list when there is nothing to go on.
 */
export function estimateSeries(history: number[], ahead = FORECAST_MONTHS): Estimate[] {
  const h = history.slice(-LOOKBACK_MONTHS);
  if (!h.length) return [];
  const weights = h.map((_, i) => i + 1);
  const wsum = weights.reduce((s, w) => s + w, 0);
  const avg = h.reduce((s, v, i) => s + v * weights[i], 0) / wsum;
  let slope = 0;
  if (h.length >= RELIABLE_MONTHS) {
    // Least-squares slope over the months used.
    const n = h.length;
    const mx = (n - 1) / 2;
    const my = h.reduce((s, v) => s + v, 0) / n;
    const num = h.reduce((s, v, i) => s + (i - mx) * (v - my), 0);
    const den = h.reduce((s, _, i) => s + (i - mx) ** 2, 0);
    slope = den ? num / den : 0;
  }
  // The weighted average sits a little before the latest month; start the trend from there.
  const centre = h.reduce((s, _, i) => s + i * weights[i], 0) / wsum;
  const lo = Math.min(...h);
  const hi = Math.max(...h);
  return Array.from({ length: ahead }, (_, k) => {
    const value = Math.max(0, avg + slope * (h.length - 1 - centre + k + 1));
    // With one month only, show ±15% so the range is not a single point.
    const spread = h.length === 1 ? Math.abs(value) * 0.15 : 0;
    return {
      value: round(value),
      low: round(Math.min(value, lo + slope * (k + 1)) - spread),
      high: round(Math.max(value, hi + slope * (k + 1)) + spread),
    };
  });
}

/** Months that are finished and have PappyJoe income in for every clinic in scope. */
export function finishedMonths(d: LedgerData, scope: ForecastScope, currentMonth: MonthKey): MonthKey[] {
  const clinics = scope === "ALL" ? CLINICS : [scope];
  const has = (c: ClinicId, m: MonthKey) =>
    d.pjReceipts.some((r) => r.clinic === c && monthOf(r.date) === m) || d.pappyJoe.some((p) => p.clinic === c && p.month === m);
  const months = new Set([...d.pjReceipts.map((r) => monthOf(r.date)), ...d.pappyJoe.map((p) => p.month)]);
  return [...months].filter((m) => m < currentMonth && clinics.every((c) => has(c, m))).sort();
}

export function forecast(d: LedgerData, scope: ForecastScope, currentMonth: MonthKey, ahead = FORECAST_MONTHS): Forecast {
  const basedOn = finishedMonths(d, scope, currentMonth).slice(-LOOKBACK_MONTHS);
  const p = basedOn.map((m) => pnl(d, m, scope));
  return fromHistory(scope, basedOn, p.map((x) => x.income), p.map((x) => x.expenses), currentMonth, ahead);
}

/** The forecast from a known history; also used for the sample-data preview. */
export function fromHistory(
  scope: ForecastScope,
  basedOn: MonthKey[],
  income: number[],
  expenses: number[],
  currentMonth: MonthKey,
  ahead = FORECAST_MONTHS,
): Forecast {
  const inc = estimateSeries(income, ahead + 1);
  const exp = estimateSeries(expenses, ahead + 1);
  return {
    scope,
    basedOn,
    reliable: basedOn.length >= RELIABLE_MONTHS,
    trend: basedOn.length >= RELIABLE_MONTHS,
    // The first month is the current one, which is not finished yet; then `ahead` more.
    months: inc.map((i, k) => ({
      month: addMonths(currentMonth, k),
      income: i,
      expenses: exp[k],
      profit: { value: i.value - exp[k].value, low: i.low - exp[k].high, high: i.high - exp[k].low },
    })),
  };
}

export function forecastNote(f: Forecast): string {
  if (!f.basedOn.length) return "Not enough data yet: a forecast needs at least one finished month with PappyJoe income imported.";
  const n = f.basedOn.length;
  if (!f.reliable)
    return `Rough estimate, not reliable yet: it is based on only ${n} finished month${n === 1 ? "" : "s"}. It becomes more dependable from ${RELIABLE_MONTHS} months of data.`;
  return `Estimate based on the last ${n} finished months, recent months weighted more, with the trend over those months.`;
}
