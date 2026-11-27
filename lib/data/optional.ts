// Some tables come from SQL that may not have been run on the live database
// yet (each feature's migration is run by hand in the Supabase SQL editor).
// Until then the feature says "not switched on yet" instead of failing.

export interface DbError {
  code?: string;
  message?: string;
}

/** Postgres / PostgREST codes for a table, column or function that does not exist. */
const MISSING_CODES = new Set(["42P01", "PGRST205", "42703", "PGRST204", "PGRST202", "42883", "PGRST200"]);

export function isNotSetUp(err: DbError | null | undefined): boolean {
  if (!err) return false;
  if (err.code && MISSING_CODES.has(err.code)) return true;
  return /does not exist|could not find the (table|function|column)|schema cache/i.test(err.message ?? "");
}

/** Thrown when a feature's SQL has not been run yet. Pages catch it and say so. */
export class NotSetUpError extends Error {
  constructor(public feature: string) {
    super(`${feature} is not switched on yet: its SQL has not been run on the database.`);
    this.name = "NotSetUpError";
  }
}

/** Data from a table that may not exist yet. */
export type Maybe<T> = { ready: true; value: T } | { ready: false };

export const ready = <T,>(value: T): Maybe<T> => ({ ready: true, value });
export const notReady = <T,>(): Maybe<T> => ({ ready: false });
