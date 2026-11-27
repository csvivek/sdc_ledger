// The app's own check for closed months, before it tries to save. On
// Supabase the database refuses anyway; this gives a clear message first.

import { getExtras } from "./data/extras";
import { closedMessage } from "./month-close";
import { monthOf } from "./calc";
import type { MonthKey } from "./types";

export async function closedMonths(): Promise<Set<MonthKey>> {
  try {
    return await getExtras().closedMonths();
  } catch (err) {
    // Never stop someone saving because this check itself failed; the database still checks.
    console.error("closedMonths failed", err);
    return new Set();
  }
}

/** The error to show when a date falls in a closed month, else undefined. */
export async function closedError(date: string, closed?: Set<MonthKey>): Promise<string | undefined> {
  const set = closed ?? (await closedMonths());
  const m = monthOf(date);
  return set.has(m) ? closedMessage(m) : undefined;
}
