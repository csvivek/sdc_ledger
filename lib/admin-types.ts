// Types for the newer admin features, kept out of lib/types.ts so open pull
// requests that change that file do not clash with this one.

import type { ClinicId, MonthKey } from "./types";

/**
 * A reconciliation gap answer (table gap_answers, from PR #15) with its
 * answer text. Read only when that table exists.
 */
export interface GapAnswerInfo {
  gapType: string;
  /** Bank row, PappyJoe receipt or expense id; for a cash gap, the month. */
  itemKey: string;
  amount: number;
  label: string;
  followUp: boolean;
  todo?: string;
  note: string;
}

/** A month-end petty cash count (table petty_cash_counts, from PR #16). Read only when that table exists. */
export interface PettyCountInfo {
  clinic: ClinicId;
  month: MonthKey;
  counted: number;
  reason?: string;
  note: string;
}
