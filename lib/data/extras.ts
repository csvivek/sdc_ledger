// Data for the newer admin features (backups, staff and activity, month
// close, recurring expenses). Kept apart from LedgerStore so the main store
// stays as it is; same idea though: a fake-data version that keeps a JSON file
// on the server, and a Supabase version that runs as the logged-in user, so
// row level security decides what it may read and change.
//
// Every Supabase table used here comes from a migration that Vivek runs by
// hand. Until it has been run, reads return { ready: false } and the page says
// the feature is not switched on yet, instead of failing.

import { promises as fs } from "fs";
import os from "os";
import path from "path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BACKUP_TABLES, type BackupDump, type BackupFormat, type BackupRecord } from "../backup";
import { createClient } from "../supabase/server";
import { isSupabaseConfigured } from "../supabase/config";
import { isNotSetUp, notReady, NotSetUpError, ready, type DbError, type Maybe } from "./optional";
import { getStore } from "./store";
import type { GapAnswerInfo, PettyCountInfo } from "../admin-types";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface ExtrasStore {
  // Backups
  /** Every table, read as the logged-in admin. */
  dumpAll(): Promise<BackupDump>;
  /** Rows per table now (cheaper than dumpAll), plus optional tables that do not exist yet. */
  countAll(): Promise<{ counts: Record<string, number>; missing: string[] }>;
  /** Remembers that a backup was downloaded. Does nothing (returns false) if the SQL is not run yet. */
  logBackup(entry: Omit<BackupRecord, "id" | "takenAt">): Promise<boolean>;
  listBackups(limit: number): Promise<Maybe<BackupRecord[]>>;

  // Answers kept by features whose SQL may not be run yet (PR #15 gap answers, PR #16 petty cash counts).
  gapAnswers(): Promise<Maybe<GapAnswerInfo[]>>;
  pettyCounts(): Promise<Maybe<PettyCountInfo[]>>;
}

// ---------------------------------------------------------------------------
// Fake-data version: a JSON file next to the main fake-data store.
// ---------------------------------------------------------------------------

/** Everything the newer features keep in fake-data mode. */
export interface ExtrasFile {
  backups: BackupRecord[];
}

const DIR = process.env.VERCEL ? path.join(os.tmpdir(), "sdc-ledger") : path.join(process.cwd(), "data");
const FILE = path.join(DIR, "extras.json");

const emptyExtras = (): ExtrasFile => ({ backups: [] });

export async function loadExtrasFile(): Promise<ExtrasFile> {
  try {
    return { ...emptyExtras(), ...(JSON.parse(await fs.readFile(FILE, "utf8")) as Partial<ExtrasFile>) };
  } catch {
    return emptyExtras();
  }
}

export async function saveExtrasFile(x: ExtrasFile) {
  await fs.mkdir(DIR, { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(x, null, 2));
}

/** Read, change and save the extras file in one go. */
export async function updateExtrasFile<T>(fn: (x: ExtrasFile) => T | Promise<T>): Promise<T> {
  const x = await loadExtrasFile();
  const out = await fn(x);
  await saveExtrasFile(x);
  return out;
}

const newId = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

class JsonExtrasStore implements ExtrasStore {
  async dumpAll(): Promise<BackupDump> {
    const d = await getStore().read();
    const x = await loadExtrasFile();
    // The fake-data store keeps app-shaped objects, not database rows; the
    // backup keeps them as they are, under the matching table names.
    const tables: Record<string, Row[]> = {
      clinics: [
        { id: "SDC1", petty_cash_opening: d.pettyCashOpening.SDC1 },
        { id: "SDC2", petty_cash_opening: d.pettyCashOpening.SDC2 },
      ],
      profiles: d.users,
      categories: d.categories.map((name) => ({ name })),
      payees: d.payees,
      expenses: d.expenses,
      petty_cash_transfers: d.pettyCashTransfers,
      pappyjoe_income: d.pappyJoe,
      bank_deposits: d.bankDeposits,
      recon_reasons: d.reconReasons,
      card_payments: d.cardPayments,
      import_batches: await getStore().listImports(10000),
      bank_rules: d.bankRules,
      bank_transactions: d.bankTxns,
      pappyjoe_receipts: d.pjReceipts,
      recon_notes: d.reconNotes,
      backup_log: x.backups,
    };
    return { tables, missing: [] };
  }

  async countAll() {
    const dump = await this.dumpAll();
    return { counts: Object.fromEntries(Object.entries(dump.tables).map(([k, v]) => [k, v.length])), missing: dump.missing };
  }

  async logBackup(entry: Omit<BackupRecord, "id" | "takenAt">) {
    await updateExtrasFile((x) => {
      x.backups.push({ ...entry, id: newId("bk"), takenAt: new Date().toISOString() });
    });
    return true;
  }

  // PR #15 / #16 keep these in the main fake-data file once merged; until then they are absent.
  async gapAnswers() {
    const d = (await getStore().read()) as unknown as { gapAnswers?: Row[]; gapReasons?: Row[] };
    if (!d.gapAnswers || !d.gapReasons) return notReady<GapAnswerInfo[]>();
    const reasons = new Map(d.gapReasons.map((r) => [r.id, r]));
    return ready(
      d.gapAnswers.map((a): GapAnswerInfo => {
        const r = reasons.get(a.reasonId);
        return { gapType: a.gapType, itemKey: a.itemKey, amount: Number(a.amount), label: r?.label ?? "", followUp: Boolean(r?.followUp), todo: r?.todo, note: a.note ?? "" };
      }),
    );
  }

  async pettyCounts() {
    const d = (await getStore().read()) as unknown as { pettyCounts?: Row[]; pettyCountReasons?: Row[] };
    if (!d.pettyCounts) return notReady<PettyCountInfo[]>();
    const reasons = new Map((d.pettyCountReasons ?? []).map((r) => [r.id, r.label as string]));
    return ready(d.pettyCounts.map((c): PettyCountInfo => ({ clinic: c.clinic, month: c.month, counted: Number(c.counted), reason: c.reasonId ? reasons.get(c.reasonId) : undefined, note: c.note ?? "" })));
  }

  async listBackups(limit: number) {
    const x = await loadExtrasFile();
    return ready([...x.backups].sort((a, b) => b.takenAt.localeCompare(a.takenAt)).slice(0, limit));
  }
}

// ---------------------------------------------------------------------------
// Supabase version
// ---------------------------------------------------------------------------

/** Throws a NotSetUpError for a missing table, or a normal error otherwise. */
function check(error: DbError | null, feature: string) {
  if (!error) return;
  if (isNotSetUp(error)) throw new NotSetUpError(feature);
  throw new Error(error.message);
}

/** Runs a read that needs a table which may not exist yet. */
async function maybe<T>(fn: () => Promise<T>): Promise<Maybe<T>> {
  try {
    return ready(await fn());
  } catch (err) {
    if (err instanceof NotSetUpError) return notReady();
    throw err;
  }
}

async function selectAllRows(sb: SupabaseClient, table: string, order: string): Promise<{ rows: Row[]; error: DbError | null }> {
  const all: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select("*").order(order).range(from, from + 999);
    if (error) return { rows: [], error };
    all.push(...(data ?? []));
    if (!data || data.length < 1000) return { rows: all, error: null };
  }
}

const toBackup = (r: Row, names: Map<string, string>): BackupRecord => ({
  id: String(r.id),
  takenAt: r.taken_at,
  takenBy: r.taken_by,
  takenByName: names.get(r.taken_by),
  format: r.format,
  totalRows: Number(r.total_rows),
  counts: r.counts ?? {},
});

export class SupabaseExtrasStore implements ExtrasStore {
  constructor(private client: () => Promise<SupabaseClient> = createClient) {}

  private async names(sb: SupabaseClient): Promise<Map<string, string>> {
    const { data } = await sb.from("profiles").select("id, name");
    return new Map((data ?? []).map((p) => [p.id as string, p.name as string]));
  }

  async dumpAll(): Promise<BackupDump> {
    const sb = await this.client();
    const results = await Promise.all(BACKUP_TABLES.map(async (t) => ({ t, ...(await selectAllRows(sb, t.name, t.order)) })));
    const tables: Record<string, Row[]> = {};
    const missing: string[] = [];
    for (const { t, rows, error } of results) {
      if (error) {
        if (t.optional && isNotSetUp(error)) {
          missing.push(t.name);
          continue;
        }
        throw new Error(`Could not read ${t.name}: ${error.message}`);
      }
      tables[t.name] = rows;
    }
    return { tables, missing };
  }

  async countAll() {
    const sb = await this.client();
    const results = await Promise.all(
      BACKUP_TABLES.map(async (t) => ({ t, ...(await sb.from(t.name).select("*", { count: "exact", head: true })) })),
    );
    const counts: Record<string, number> = {};
    const missing: string[] = [];
    for (const { t, count, error } of results) {
      if (error) {
        if (t.optional && isNotSetUp(error)) missing.push(t.name);
        else throw new Error(`Could not count ${t.name}: ${error.message}`);
        continue;
      }
      counts[t.name] = count ?? 0;
    }
    return { counts, missing };
  }

  async logBackup(entry: Omit<BackupRecord, "id" | "takenAt">) {
    const sb = await this.client();
    const { error } = await sb.from("backup_log").insert({
      format: entry.format satisfies BackupFormat,
      total_rows: entry.totalRows,
      counts: entry.counts,
      taken_by: entry.takenBy,
    });
    if (error && isNotSetUp(error)) return false;
    if (error) throw new Error(error.message);
    return true;
  }

  async listBackups(limit: number) {
    return maybe(async () => {
      const sb = await this.client();
      const { data, error } = await sb.from("backup_log").select("*").order("taken_at", { ascending: false }).limit(limit);
      check(error, "Backup history");
      const names = await this.names(sb);
      return (data ?? []).map((r) => toBackup(r, names));
    });
  }

  async gapAnswers() {
    return maybe(async () => {
      const sb = await this.client();
      const [answers, reasons] = await Promise.all([sb.from("gap_answers").select("*"), sb.from("gap_reasons").select("*")]);
      check(answers.error, "Gap answers");
      check(reasons.error, "Gap answers");
      const byId = new Map((reasons.data ?? []).map((r) => [r.id, r]));
      return (answers.data ?? []).map((a): GapAnswerInfo => {
        const r = byId.get(a.reason_id);
        return { gapType: a.gap_type, itemKey: a.item_key, amount: Number(a.amount), label: r?.label ?? "", followUp: Boolean(r?.follow_up), todo: r?.todo ?? undefined, note: a.note ?? "" };
      });
    });
  }

  async pettyCounts() {
    return maybe(async () => {
      const sb = await this.client();
      const [counts, reasons] = await Promise.all([sb.from("petty_cash_counts").select("*"), sb.from("petty_count_reasons").select("*")]);
      check(counts.error, "Petty cash counts");
      const byId = new Map((reasons.data ?? []).map((r) => [r.id, r.label as string]));
      return (counts.data ?? []).map((c): PettyCountInfo => ({ clinic: c.clinic, month: c.month, counted: Number(c.counted), reason: c.reason_id ? byId.get(c.reason_id) : undefined, note: c.note ?? "" }));
    });
  }
}

let extras: ExtrasStore | undefined;
export function getExtras(): ExtrasStore {
  extras ??= isSupabaseConfigured ? new SupabaseExtrasStore() : new JsonExtrasStore();
  return extras;
}

export { newId };
