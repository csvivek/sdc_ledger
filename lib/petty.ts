// Month-end petty cash counts: the built-in reasons, and the label check that
// keeps the reason list free of near-duplicates. The migration
// 20261129000000_petty_cash_counts.sql inserts the same built-in rows.

import type { PettyCountReason } from "./types";

export const SEED_PETTY_REASONS: PettyCountReason[] = [
  ["pc_not_entered", "An expense was paid but not entered in the portal yet"],
  ["pc_wrong_entry", "An expense was entered twice or with the wrong amount"],
  ["pc_other_clinic", "Paid from the other clinic's petty cash"],
  ["pc_advance", "Cash given as a staff advance or loan"],
  ["pc_patient_cash", "Patient cash got mixed with petty cash"],
  ["pc_not_split", "A withdrawal was not split equally between the clinics"],
  ["pc_miscount", "Counting mistake (this count or the last one)"],
  ["pc_not_sure", "Not sure yet"],
].map(([code, label], i) => ({ id: `pcr_${code}`, code, label, active: true, sortOrder: i + 1 }));

/** Same text, ignoring case and extra spaces. */
export const normaliseLabel = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

export function findReasonByLabel(reasons: PettyCountReason[], label: string) {
  const key = normaliseLabel(label);
  return reasons.find((r) => normaliseLabel(r.label) === key);
}

/** Below half a paisa counts as no difference. */
export const differs = (difference: number) => Math.abs(difference) >= 0.005;

/** The "Something else…" choice in the reason list. */
export const OTHER_REASON = "__other";
