import type { MonthKey } from "../types";

/** Why a month delete was refused. NEEDS_MIGRATION: the database update for this feature is not applied yet. */
export class ImportDeleteError extends Error {
  constructor(
    public code: "NOTHING_TO_DELETE" | "CREDITED_CARDS" | "BAD_REQUEST" | "NEEDS_MIGRATION",
    public count = 0,
  ) {
    super(code);
  }
}

/** True when a YYYY-MM-DD date falls in the YYYY-MM month. */
export const inMonth = (date: string, month: MonthKey) => date.slice(0, 7) === month;
