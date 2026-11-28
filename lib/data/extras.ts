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
import type { ActivityEntry, ActivityFilter } from "../activity";
import type { ClinicId, MonthKey, Role, User } from "../types";
import type { CheckItem, CloseEvent, MonthClose } from "../month-close";
import type { RecurringTemplate, TemplateInput } from "../recurring";

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

  // Staff logins
  listPeople(): Promise<{ people: Person[]; loginInfo: boolean }>;
  /** Changes a person's name, role, home clinic or on/off. Refuses to remove the last active admin. */
  updatePerson(id: string, patch: PersonPatch): Promise<void>;

  // Activity log
  listActivity(filter: ActivityFilter): Promise<Maybe<ActivityEntry[]>>;
  /**
   * Writes a log line. Only the fake-data store does this: on Supabase the
   * database triggers write the log, so the app never can (or needs to).
   */
  noteActivity(e: Omit<ActivityEntry, "id" | "at" | "actorName">): Promise<void>;

  // Month close
  listCloses(): Promise<Maybe<MonthClose[]>>;
  /** Months closed now. Empty until the month close SQL is run. Readable by staff too. */
  closedMonths(): Promise<Set<MonthKey>>;
  closeEvents(month: MonthKey): Promise<Maybe<CloseEvent[]>>;
  closeMonth(month: MonthKey, checklist: CheckItem[], note: string, by: string): Promise<void>;
  reopenMonth(month: MonthKey, reason: string, by: string): Promise<void>;

  // Recurring expenses (admin only)
  /** Every template, hidden ones too. Not ready until the recurring SQL is run. */
  listTemplates(): Promise<Maybe<RecurringTemplate[]>>;
  /** Adds a template, or changes the one with `id`. Throws DuplicateLabelError for a name already used. */
  saveTemplate(t: TemplateInput, id?: string): Promise<RecurringTemplate>;
  setTemplateActive(id: string, active: boolean): Promise<void>;
}

/** Another template already has this name (two people saving at once). */
export class DuplicateLabelError extends Error {
  constructor() {
    super("A recurring expense with this name already exists.");
    this.name = "DuplicateLabelError";
  }
}

/** The month was already closed, or was not closed, when someone else got there first. */
export class CloseStateError extends Error {
  constructor(public code: "ALREADY_CLOSED" | "NOT_CLOSED" | "MONTH_NOT_OVER") {
    super(code);
    this.name = "CloseStateError";
  }
}

export interface Person extends User {
  email?: string;
  lastSignIn?: string;
  createdAt?: string;
}

export interface PersonPatch {
  name: string;
  role: Role;
  clinic?: ClinicId;
  active: boolean;
}

/** Thrown when a change would leave no active admin. */
export class LastAdminError extends Error {
  constructor() {
    super("At least one active admin must remain.");
    this.name = "LastAdminError";
  }
}

// ---------------------------------------------------------------------------
// Fake-data version: a JSON file next to the main fake-data store.
// ---------------------------------------------------------------------------

/** Everything the newer features keep in fake-data mode. */
export interface ExtrasFile {
  backups: BackupRecord[];
  activity: ActivityEntry[];
  closes: MonthClose[];
  closeEvents: CloseEvent[];
  templates: RecurringTemplate[];
}

const DIR = process.env.VERCEL ? path.join(os.tmpdir(), "sdc-ledger") : path.join(process.cwd(), "data");
const FILE = path.join(DIR, "extras.json");

const emptyExtras = (): ExtrasFile => ({ backups: [], activity: [], closes: [], closeEvents: [], templates: [] });

/** The main fake-data file (lib/data/store.ts); people live in its users list. */
const STORE_FILE = path.join(DIR, "store.json");

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

  async listPeople() {
    const d = await getStore().read();
    return { people: d.users.map((u) => ({ ...u, active: u.active !== false })), loginInfo: false };
  }

  async updatePerson(id: string, patch: PersonPatch) {
    await getStore().read(); // makes sure the file exists
    const raw = JSON.parse(await fs.readFile(STORE_FILE, "utf8")) as { users: User[] };
    const u = raw.users.find((x) => x.id === id);
    if (!u) throw new Error("Person not found");
    const next: User = { ...u, name: patch.name, role: patch.role, clinic: patch.clinic, active: patch.active };
    const adminsLeft = raw.users.map((x) => (x.id === id ? next : x)).filter((x) => x.role === "admin" && x.active !== false);
    if (!adminsLeft.length) throw new LastAdminError();
    Object.assign(u, next);
    if (!patch.clinic) delete u.clinic;
    await fs.writeFile(STORE_FILE, JSON.stringify(raw, null, 2));
  }

  async listActivity(f: ActivityFilter) {
    const x = await loadExtrasFile();
    const d = await getStore().read();
    const names = new Map(d.users.map((u) => [u.id, u.name]));
    const day = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(iso));
    const beforeAt = f.before ? x.activity.find((e) => e.id === f.before)?.at : undefined;
    const rows = [...x.activity]
      .sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id))
      .filter((e) => (!f.actorId || e.actorId === f.actorId) && (!f.entity || e.entity === f.entity))
      .filter((e) => (!f.from || day(e.at) >= f.from) && (!f.to || day(e.at) <= f.to))
      .filter((e) => !beforeAt || e.at < beforeAt || (e.at === beforeAt && e.id < f.before!))
      .slice(0, f.limit)
      .map((e) => ({ ...e, actorName: e.actorId ? names.get(e.actorId) : undefined }));
    return ready(rows);
  }

  async noteActivity(e: Omit<ActivityEntry, "id" | "at" | "actorName">) {
    await updateExtrasFile((x) => {
      // Ids sort in time order, so "Older" paging works.
      x.activity.push({ ...e, id: `act_${String(Date.now()).padStart(15, "0")}_${String(x.activity.length).padStart(6, "0")}`, at: new Date().toISOString() });
    });
  }

  async listCloses() {
    const x = await loadExtrasFile();
    const names = new Map((await getStore().read()).users.map((u) => [u.id, u.name]));
    return ready(x.closes.map((c) => ({ ...c, closedByName: c.closedBy ? names.get(c.closedBy) : undefined })).sort((a, b) => b.month.localeCompare(a.month)));
  }

  async closedMonths() {
    const x = await loadExtrasFile();
    return new Set(x.closes.filter((c) => c.closed).map((c) => c.month));
  }

  async closeEvents(month: MonthKey) {
    const x = await loadExtrasFile();
    return ready(x.closeEvents.filter((e) => e.month === month).sort((a, b) => b.at.localeCompare(a.at)));
  }

  async closeMonth(month: MonthKey, checklist: CheckItem[], note: string, by: string) {
    const name = (await getStore().read()).users.find((u) => u.id === by)?.name;
    await updateExtrasFile((x) => {
      const c = x.closes.find((y) => y.month === month);
      if (c?.closed) throw new CloseStateError("ALREADY_CLOSED");
      const row: MonthClose = { month, closed: true, closedBy: by, closedAt: new Date().toISOString(), note, checklist };
      if (c) Object.assign(c, row);
      else x.closes.push(row);
      x.closeEvents.push({ id: newId("ce"), month, action: "close", reason: note, byName: name, at: new Date().toISOString() });
    });
  }

  async reopenMonth(month: MonthKey, reason: string, by: string) {
    const name = (await getStore().read()).users.find((u) => u.id === by)?.name;
    await updateExtrasFile((x) => {
      const c = x.closes.find((y) => y.month === month);
      if (!c?.closed) throw new CloseStateError("NOT_CLOSED");
      Object.assign(c, { closed: false, reopenedByName: name, reopenedAt: new Date().toISOString(), reopenReason: reason });
      x.closeEvents.push({ id: newId("ce"), month, action: "reopen", reason, byName: name, at: new Date().toISOString() });
    });
  }

  async listBackups(limit: number) {
    const x = await loadExtrasFile();
    // Newest first; two downloads in the same millisecond keep the later one first.
    return ready([...x.backups].reverse().sort((a, b) => b.takenAt.localeCompare(a.takenAt)).slice(0, limit));
  }

  async listTemplates() {
    return ready((await loadExtrasFile()).templates);
  }

  async saveTemplate(t: TemplateInput, id?: string) {
    return updateExtrasFile((x) => {
      const norm = (l: string) => l.trim().replace(/\s+/g, " ").toLowerCase();
      if (x.templates.some((y) => y.id !== id && norm(y.label) === norm(t.label))) throw new DuplicateLabelError();
      const old = id ? x.templates.find((y) => y.id === id) : undefined;
      if (id && !old) throw new Error("Recurring expense not found");
      if (old) {
        Object.assign(old, t, { payeeId: t.payeeId, pettyCashClinic: t.pettyCashClinic });
        return old;
      }
      const row: RecurringTemplate = { ...t, id: newId("rt"), active: true, sortOrder: 100 };
      x.templates.push(row);
      return row;
    });
  }

  async setTemplateActive(id: string, active: boolean) {
    await updateExtrasFile((x) => {
      const t = x.templates.find((y) => y.id === id);
      if (t) t.active = active;
    });
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

  async listPeople() {
    const sb = await this.client();
    const [profiles, info] = await Promise.all([sb.from("profiles").select("*").order("name"), sb.rpc("admin_login_info")]);
    if (profiles.error) throw new Error(profiles.error.message);
    const loginInfo = !info.error;
    if (info.error && !isNotSetUp(info.error)) console.error("admin_login_info failed", info.error.message);
    const byId = new Map(((info.data as Row[] | null) ?? []).map((r) => [r.id as string, r]));
    const people = (profiles.data ?? []).map((r): Person => {
      const i = byId.get(r.id);
      return {
        id: r.id,
        name: r.name,
        role: r.role,
        clinic: r.clinic ?? undefined,
        active: r.active ?? true,
        email: i?.email ?? r.email ?? undefined,
        lastSignIn: i?.last_sign_in_at ?? undefined,
        createdAt: i?.created_at ?? r.created_at ?? undefined,
      };
    });
    return { people, loginInfo };
  }

  async updatePerson(id: string, patch: PersonPatch) {
    const sb = await this.client();
    const row: Row = { name: patch.name, role: patch.role, clinic: patch.clinic ?? null, active: patch.active };
    let { data, error } = await sb.from("profiles").update(row).eq("id", id).select("id");
    if (error && isNotSetUp(error)) {
      // Before the staff SQL there is no on/off column: other changes still work.
      if (!patch.active) throw new NotSetUpError("Switching a login off");
      delete row.active;
      ({ data, error } = await sb.from("profiles").update(row).eq("id", id).select("id"));
    }
    if (error && /LAST_ADMIN/.test(error.message)) throw new LastAdminError();
    if (error) throw new Error(error.message);
    if (!data?.length) throw new Error("Person not found");
  }

  async listActivity(f: ActivityFilter) {
    return maybe(async () => {
      const sb = await this.client();
      let q = sb.from("activity_log").select("*").order("id", { ascending: false }).limit(f.limit);
      if (f.actorId) q = q.eq("actor", f.actorId);
      if (f.entity) q = q.eq("entity", f.entity);
      // Days are in India time (UTC+5:30).
      if (f.from) q = q.gte("at", new Date(`${f.from}T00:00:00+05:30`).toISOString());
      if (f.to) q = q.lt("at", new Date(new Date(`${f.to}T00:00:00+05:30`).getTime() + 86400000).toISOString());
      if (f.before && /^\d+$/.test(f.before)) q = q.lt("id", Number(f.before));
      const { data, error } = await q;
      check(error, "Activity log");
      const names = await this.names(sb);
      return (data ?? []).map(
        (r): ActivityEntry => ({
          id: String(r.id),
          at: r.at,
          actorId: r.actor ?? undefined,
          actorName: r.actor ? names.get(r.actor) : undefined,
          action: r.action,
          entity: r.entity,
          entityId: r.entity_id ?? undefined,
          before: r.before ?? undefined,
          after: r.after ?? undefined,
        }),
      );
    });
  }

  async noteActivity() {
    // Written by database triggers on Supabase.
  }

  async listCloses() {
    return maybe(async () => {
      const sb = await this.client();
      const { data, error } = await sb.from("month_closes").select("*").order("month", { ascending: false });
      check(error, "Month close");
      const names = await this.names(sb);
      return (data ?? []).map(
        (r): MonthClose => ({
          month: r.month,
          closed: r.closed,
          closedBy: r.closed_by ?? undefined,
          closedByName: r.closed_by ? names.get(r.closed_by) : undefined,
          closedAt: r.closed_at ?? undefined,
          note: r.note ?? "",
          checklist: Array.isArray(r.checklist) ? r.checklist : [],
          reopenedByName: r.reopened_by ? names.get(r.reopened_by) : undefined,
          reopenedAt: r.reopened_at ?? undefined,
          reopenReason: r.reopen_reason ?? undefined,
        }),
      );
    });
  }

  async closedMonths() {
    const sb = await this.client();
    const { data, error } = await sb.from("month_closes").select("month").eq("closed", true);
    if (error && isNotSetUp(error)) return new Set<MonthKey>();
    if (error) throw new Error(error.message);
    return new Set((data ?? []).map((r) => r.month as MonthKey));
  }

  async closeEvents(month: MonthKey) {
    return maybe(async () => {
      const sb = await this.client();
      const { data, error } = await sb.from("month_close_events").select("*").eq("month", month).order("id", { ascending: false });
      check(error, "Month close");
      const names = await this.names(sb);
      return (data ?? []).map((r): CloseEvent => ({ id: String(r.id), month: r.month, action: r.action, reason: r.reason ?? "", byName: r.done_by ? names.get(r.done_by) : undefined, at: r.done_at }));
    });
  }

  private async closeRpc(name: string, args: Row) {
    const sb = await this.client();
    const { error } = await sb.rpc(name, args);
    if (!error) return;
    if (isNotSetUp(error)) throw new NotSetUpError("Month close");
    const code = error.message.match(/ALREADY_CLOSED|NOT_CLOSED|MONTH_NOT_OVER/)?.[0];
    if (code) throw new CloseStateError(code as CloseStateError["code"]);
    throw new Error(error.message);
  }

  // The database records who did it (auth.uid()), so `by` is not sent.
  async closeMonth(month: MonthKey, checklist: CheckItem[], note: string, _by?: string) {
    await this.closeRpc("close_month", { p_month: month, p_checklist: checklist, p_note: note });
  }

  async reopenMonth(month: MonthKey, reason: string, _by?: string) {
    await this.closeRpc("reopen_month", { p_month: month, p_reason: reason });
  }

  async listTemplates() {
    return maybe(async () => {
      const sb = await this.client();
      // The expenses columns come from the same SQL file; check them too, so the page never offers a tap that cannot save.
      const [t, e] = await Promise.all([
        sb.from("recurring_templates").select("*").order("sort_order").order("label"),
        sb.from("expenses").select("recurring_template_id, recurring_month").limit(1),
      ]);
      check(t.error, "Recurring expenses");
      check(e.error, "Recurring expenses");
      return (t.data ?? []).map(toTemplate);
    });
  }

  async saveTemplate(t: TemplateInput, id?: string) {
    const sb = await this.client();
    const row = {
      label: t.label,
      category: t.category,
      payee_id: t.payeeId ?? null,
      clinic: t.clinic,
      paid_by: t.paidBy,
      petty_cash_clinic: t.paidBy === "PETTY_CASH" ? (t.pettyCashClinic ?? null) : null,
      amount: t.amount,
      day_of_month: t.dayOfMonth,
      note: t.note,
    };
    const q = id ? sb.from("recurring_templates").update(row).eq("id", id) : sb.from("recurring_templates").insert(row);
    const { data, error } = await q.select().single();
    if (error?.code === "23505") throw new DuplicateLabelError();
    check(error, "Recurring expenses");
    return toTemplate(data as Row);
  }

  async setTemplateActive(id: string, active: boolean) {
    const sb = await this.client();
    const { error } = await sb.from("recurring_templates").update({ active }).eq("id", id);
    check(error, "Recurring expenses");
  }
}

const toTemplate = (r: Row): RecurringTemplate => ({
  id: String(r.id),
  label: r.label,
  category: r.category,
  payeeId: r.payee_id ?? undefined,
  clinic: r.clinic,
  paidBy: r.paid_by,
  pettyCashClinic: r.petty_cash_clinic ?? undefined,
  amount: Number(r.amount),
  dayOfMonth: Number(r.day_of_month),
  note: r.note ?? "",
  active: r.active !== false,
  sortOrder: Number(r.sort_order ?? 100),
});

let extras: ExtrasStore | undefined;
export function getExtras(): ExtrasStore {
  extras ??= isSupabaseConfigured ? new SupabaseExtrasStore() : new JsonExtrasStore();
  return extras;
}

export { newId };
