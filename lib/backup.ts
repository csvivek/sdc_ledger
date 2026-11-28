// Data backups. Pure functions, no I/O.
//
// What Supabase does: on the Free plan it keeps NO automatic backups of the
// database (Pro keeps 7 days of daily backups). The app cannot ask Supabase
// for its backup list without a management token, which this app does not
// have and should not have. So the app does not pretend to know: it offers a
// full download of every table, remembers when the last one was taken, and
// reminds the admin when that is too long ago.

export type BackupFormat = "json" | "xlsx";

/** Remind the admin when the last download is older than this. */
export const BACKUP_REMIND_DAYS = 7;

/** Bumped if the file layout ever changes, so an old file can still be read correctly. */
export const BACKUP_FILE_VERSION = 1;

export interface BackupTable {
  name: string;
  /** Column to sort by, so paging through a big table is stable. */
  order: string;
  /** Tables from features whose SQL may not have been run yet. Skipped (and listed) when missing. */
  optional?: boolean;
  /** What it holds, for the backup page. */
  about: string;
}

export const BACKUP_TABLES: BackupTable[] = [
  { name: "clinics", order: "id", about: "Clinics and opening petty cash" },
  { name: "profiles", order: "id", about: "People who can log in (name, role, clinic)" },
  { name: "categories", order: "name", about: "Expense categories" },
  { name: "payees", order: "id", about: "Staff, labs, suppliers, consultants, landlords" },
  { name: "expenses", order: "id", about: "Expenses entered in the app" },
  { name: "petty_cash_transfers", order: "id", about: "Petty cash given to the clinics" },
  { name: "pappyjoe_income", order: "month", about: "Older typed-in PappyJoe totals" },
  { name: "bank_deposits", order: "id", about: "Older typed-in bank deposits" },
  { name: "recon_reasons", order: "month", about: "Reasons for gaps (older form)" },
  { name: "card_payments", order: "id", about: "Card payments to reach the bank" },
  { name: "import_batches", order: "id", about: "Each file imported" },
  { name: "bank_rules", order: "id", about: "Bank payment rules" },
  { name: "bank_transactions", order: "id", about: "HDFC statement rows" },
  { name: "pappyjoe_receipts", order: "id", about: "PappyJoe payment lines" },
  { name: "recon_notes", order: "month", about: "Reconciliation notes" },
  // From features that need their SQL run first.
  { name: "gap_reasons", order: "id", optional: true, about: "Answers offered for reconciliation gaps" },
  { name: "gap_answers", order: "id", optional: true, about: "Answers given for reconciliation gaps" },
  { name: "gap_rules", order: "id", optional: true, about: "Remembered gap answers" },
  { name: "petty_count_reasons", order: "id", optional: true, about: "Reasons for petty cash count differences" },
  { name: "petty_cash_counts", order: "id", optional: true, about: "Month-end petty cash counts" },
  { name: "import_deletions", order: "id", optional: true, about: "Imported months that were deleted" },
  { name: "category_changes", order: "id", optional: true, about: "Category change history" },
  { name: "activity_log", order: "id", optional: true, about: "Who added, changed or deleted what" },
  { name: "month_closes", order: "month", optional: true, about: "Closed months" },
  { name: "month_close_events", order: "id", optional: true, about: "Month close and reopen history" },
  { name: "recurring_templates", order: "id", optional: true, about: "Recurring monthly expenses" },
  { name: "backup_log", order: "id", optional: true, about: "When backups were downloaded" },
];

export interface BackupDump {
  /** Rows per table, as stored. */
  tables: Record<string, Record<string, unknown>[]>;
  /** Optional tables that do not exist yet on this database. */
  missing: string[];
}

export interface BackupRecord {
  id: string;
  takenAt: string;
  takenBy: string;
  takenByName?: string;
  format: BackupFormat;
  totalRows: number;
  /** Rows per table in that backup. */
  counts: Record<string, number>;
}

export interface BackupFile {
  app: "SDC Ledger";
  version: number;
  createdAt: string;
  createdBy: string;
  note: string;
  counts: Record<string, number>;
  missing: string[];
  tables: Record<string, Record<string, unknown>[]>;
}

export const countsOf = (dump: BackupDump): Record<string, number> =>
  Object.fromEntries(Object.entries(dump.tables).map(([k, v]) => [k, v.length]));

export const totalRows = (counts: Record<string, number>) => Object.values(counts).reduce((s, n) => s + n, 0);

export function buildBackupFile(dump: BackupDump, createdBy: string, now = new Date()): BackupFile {
  return {
    app: "SDC Ledger",
    version: BACKUP_FILE_VERSION,
    createdAt: now.toISOString(),
    createdBy,
    note: "Full copy of every SDC Ledger table. Logins and passwords are kept by Supabase and are not in this file. Keep it somewhere safe, such as Google Drive.",
    counts: countsOf(dump),
    missing: dump.missing,
    tables: dump.tables,
  };
}

/** File name with the date and time in India, e.g. sdc-ledger-backup-2026-11-28-0930.json */
export function backupFileName(format: BackupFormat, now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const p = (t: string) => parts.find((x) => x.type === t)?.value ?? "";
  return `sdc-ledger-backup-${p("year")}-${p("month")}-${p("day")}-${p("hour")}${p("minute")}.${format}`;
}

export interface BackupStatus {
  /** Days since the last backup, or null when there has never been one. */
  daysSince: number | null;
  due: boolean;
}

export function backupStatus(lastTakenAt: string | undefined, now = new Date(), remindDays = BACKUP_REMIND_DAYS): BackupStatus {
  if (!lastTakenAt) return { daysSince: null, due: true };
  const days = Math.floor((now.getTime() - Date.parse(lastTakenAt)) / 86400000);
  return { daysSince: days, due: days >= remindDays };
}

export function backupAgeText(s: BackupStatus): string {
  if (s.daysSince === null) return "No backup has been downloaded yet";
  if (s.daysSince === 0) return "Last backup was downloaded today";
  if (s.daysSince === 1) return "Last backup was downloaded yesterday";
  return `Last backup was downloaded ${s.daysSince} days ago`;
}

export interface BackupCheck {
  ok: boolean;
  /** What went wrong, when ok is false. */
  problem?: string;
  createdAt?: string;
  createdBy?: string;
  /** Per table: rows in the file and rows in the database now. */
  tables: { name: string; inFile: number; now: number | null }[];
  totalInFile: number;
}

/**
 * Reads a backup file the admin uploads and says whether it is complete and
 * readable, comparing row counts with the database now. Never changes data.
 */
export function checkBackupFile(text: string, nowCounts: Record<string, number>): BackupCheck {
  const fail = (problem: string): BackupCheck => ({ ok: false, problem, tables: [], totalInFile: 0 });
  let f: Partial<BackupFile>;
  try {
    f = JSON.parse(text);
  } catch {
    return fail("This is not a readable backup file. Pick the .json file downloaded from this page (the Excel copy cannot be checked).");
  }
  if (!f || typeof f !== "object" || f.app !== "SDC Ledger" || typeof f.tables !== "object" || !f.tables) {
    return fail("This file is not an SDC Ledger backup.");
  }
  if (typeof f.version !== "number" || f.version > BACKUP_FILE_VERSION) {
    return fail("This backup was made by a newer version of the app.");
  }
  const tables = f.tables as Record<string, unknown>;
  for (const [name, rows] of Object.entries(tables)) {
    if (!Array.isArray(rows)) return fail(`The table ${name} in this file is damaged.`);
  }
  const required = BACKUP_TABLES.filter((t) => !t.optional).map((t) => t.name);
  const absent = required.filter((n) => !Array.isArray(tables[n]));
  if (absent.length) return fail(`This file is missing ${absent.length} table(s): ${absent.join(", ")}.`);
  const counts = f.counts ?? {};
  const mismatch = Object.entries(tables).find(([n, rows]) => typeof counts[n] === "number" && counts[n] !== (rows as unknown[]).length);
  if (mismatch) return fail(`The file looks cut short: table ${mismatch[0]} should have ${counts[mismatch[0]]} rows.`);

  const names = [...new Set([...BACKUP_TABLES.map((t) => t.name).filter((n) => n in tables || n in nowCounts)])];
  const rows = names.map((name) => ({
    name,
    inFile: Array.isArray(tables[name]) ? (tables[name] as unknown[]).length : 0,
    now: name in nowCounts ? nowCounts[name] : null,
  }));
  return {
    ok: true,
    createdAt: f.createdAt,
    createdBy: f.createdBy,
    tables: rows,
    totalInFile: rows.reduce((s, r) => s + r.inFile, 0),
  };
}

/** Excel sheet names: at most 31 characters, none of : \ / ? * [ ] */
export const sheetName = (s: string) => s.replace(/[:\\/?*[\]]/g, " ").slice(0, 31);

/** One sheet per table: a header row of column names, then the rows. Objects are written as JSON text. */
export function backupSheets(dump: BackupDump): { name: string; rows: unknown[][] }[] {
  return Object.entries(dump.tables).map(([name, rows]) => {
    const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
    return {
      name: sheetName(name),
      rows: [cols, ...rows.map((r) => cols.map((c) => cell(r[c])))],
    };
  });
}

function cell(v: unknown): unknown {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return v;
}
