// Which entries the "entries" list on the Add expense page shows.
// "latest" is the newest entries by when they were typed in (the old list);
// a month (YYYY-MM) is every entry dated in that month.

import type { ClinicOrShared, Expense, MonthKey } from "./types";

export type EntriesView = "latest" | MonthKey;
export type ClinicFilter = ClinicOrShared | "ALL";

export const CLINIC_FILTERS: ClinicFilter[] = ["ALL", "SDC1", "SDC2", "SHARED"];

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isMonthKey(s: string | undefined): s is MonthKey {
  return !!s && MONTH_RE.test(s);
}

/** The month n months after m (n can be negative). */
export function shiftMonth(m: MonthKey, n: number): MonthKey {
  const [y, mo] = m.split("-").map(Number);
  const i = y * 12 + (mo - 1) + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
}

/** First day of the month and first day of the next month, for a date range query (from <= date < to). */
export function monthRange(m: MonthKey): { from: string; to: string } {
  return { from: `${m}-01`, to: `${shiftMonth(m, 1)}-01` };
}

/**
 * Months to offer, newest first: from the month of the first entry this user
 * can see up to the current month. Never empty: with no entries yet it is
 * just the current month.
 */
export function monthOptions(firstDate: string | undefined, currentMonth: MonthKey): MonthKey[] {
  let first = firstDate && isMonthKey(firstDate.slice(0, 7)) ? firstDate.slice(0, 7) : currentMonth;
  if (first > currentMonth) first = currentMonth;
  const out: MonthKey[] = [];
  for (let m = currentMonth; m >= first; m = shiftMonth(m, -1)) out.push(m);
  return out;
}

/** Reads ?view=: a month in the list, otherwise the latest entries. */
export function pickView(requested: string | undefined, months: MonthKey[]): EntriesView {
  return isMonthKey(requested) && months.includes(requested) ? requested : "latest";
}

export function pickClinic(requested: string | undefined): ClinicFilter {
  return CLINIC_FILTERS.includes(requested as ClinicFilter) ? (requested as ClinicFilter) : "ALL";
}

export function filterByClinic(expenses: Expense[], clinic: ClinicFilter): Expense[] {
  return clinic === "ALL" ? expenses : expenses.filter((e) => e.clinic === clinic);
}

/** Totals for a list of entries. Shared entries are shown on their own, not split. */
export function entryTotals(expenses: Expense[]) {
  const byClinic: Record<ClinicOrShared, number> = { SDC1: 0, SDC2: 0, SHARED: 0 };
  let total = 0;
  for (const e of expenses) {
    byClinic[e.clinic] += e.amount;
    total += e.amount;
  }
  return { total, count: expenses.length, byClinic };
}

/** Link to the Add expense page for a view and clinic, leaving out the defaults. */
export function entriesHref(view: EntriesView, clinic: ClinicFilter): string {
  const q = new URLSearchParams();
  if (view !== "latest") q.set("view", view);
  if (clinic !== "ALL") q.set("clinic", clinic);
  const s = q.toString();
  return `/expenses${s ? `?${s}` : ""}#entries`;
}
