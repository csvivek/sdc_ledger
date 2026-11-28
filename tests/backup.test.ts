import { beforeEach, describe, expect, it, vi } from "vitest";
import { ADMIN, resetStore } from "./helpers";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAdmin: vi.fn(async () => ADMIN), requireUser: vi.fn(async () => ADMIN), SESSION_COOKIE: "t" }));

const backup = await import("@/lib/backup");
const { getExtras } = await import("@/lib/data/extras");
const { checkBackup } = await import("@/app/backup/actions");
const { isNotSetUp } = await import("@/lib/data/optional");

beforeEach(resetStore);

describe("backup reminder", () => {
  const now = new Date("2026-11-28T06:00:00Z");
  it("is due when there has never been a backup", () => {
    expect(backup.backupStatus(undefined, now)).toEqual({ daysSince: null, due: true });
    expect(backup.backupAgeText(backup.backupStatus(undefined, now))).toMatch(/No backup/);
  });
  it("is not due for 6 days, then due on day 7", () => {
    expect(backup.backupStatus("2026-11-22T07:00:00Z", now)).toEqual({ daysSince: 5, due: false });
    expect(backup.backupStatus("2026-11-21T05:00:00Z", now).due).toBe(true);
  });
  it("names files with the date and time in India", () => {
    expect(backup.backupFileName("json", now)).toBe("sdc-ledger-backup-2026-11-28-1130.json");
    expect(backup.backupFileName("xlsx", now)).toMatch(/\.xlsx$/);
  });
});

describe("full backup in fake-data mode", () => {
  it("contains every core table with its rows", async () => {
    const dump = await getExtras().dumpAll();
    for (const t of backup.BACKUP_TABLES.filter((t) => !t.optional)) expect(dump.tables[t.name], t.name).toBeInstanceOf(Array);
    expect(dump.tables.expenses.length).toBeGreaterThan(0);
  });

  it("remembers each download, newest first", async () => {
    const x = getExtras();
    expect((await x.listBackups(5)).ready).toBe(true);
    await x.logBackup({ takenBy: "admin", format: "json", totalRows: 10, counts: { expenses: 10 } });
    await x.logBackup({ takenBy: "admin", format: "xlsx", totalRows: 12, counts: { expenses: 12 } });
    const h = await x.listBackups(5);
    expect(h.ready && h.value.map((b) => b.format)).toEqual(["xlsx", "json"]);
  });

  it("writes one Excel sheet per table with a header row", async () => {
    const sheets = backup.backupSheets({ tables: { expenses: [{ id: "a", amount: 5, meta: { x: 1 } }] }, missing: [] });
    expect(sheets[0]).toEqual({ name: "expenses", rows: [["id", "amount", "meta"], ["a", 5, '{"x":1}']] });
    expect(backup.sheetName("a/b:c".repeat(10)).length).toBeLessThanOrEqual(31);
  });
});

describe("checking a backup file", () => {
  const fileFrom = async () => {
    const dump = await getExtras().dumpAll();
    return backup.buildBackupFile(dump, "Test Admin", new Date("2026-11-28T00:00:00Z"));
  };

  it("says a fresh backup is complete and compares counts with now", async () => {
    const f = await fileFrom();
    const { counts } = await getExtras().countAll();
    const r = backup.checkBackupFile(JSON.stringify(f), counts);
    expect(r.ok).toBe(true);
    const exp = r.tables.find((t) => t.name === "expenses")!;
    expect(exp.inFile).toBe(exp.now);
    expect(r.totalInFile).toBe(backup.totalRows(f.counts));
  });

  it("spots a file that is cut short, not a backup, or missing tables", async () => {
    const f = await fileFrom();
    expect(backup.checkBackupFile("{not json", {}).problem).toMatch(/not a readable backup/);
    expect(backup.checkBackupFile(JSON.stringify({ hello: 1 }), {}).problem).toMatch(/not an SDC Ledger backup/);
    const cut = { ...f, tables: { ...f.tables, expenses: f.tables.expenses.slice(1) } };
    expect(backup.checkBackupFile(JSON.stringify(cut), {}).problem).toMatch(/cut short: table expenses/);
    const { expenses, ...rest } = f.tables;
    void expenses;
    expect(backup.checkBackupFile(JSON.stringify({ ...f, tables: rest }), {}).problem).toMatch(/missing 1 table\(s\): expenses/);
    expect(backup.checkBackupFile(JSON.stringify({ ...f, version: 99 }), {}).problem).toMatch(/newer version/);
  });

  it("the Check action reads an uploaded file and never changes data", async () => {
    const before = await getExtras().countAll();
    const f = await fileFrom();
    const fd = new FormData();
    fd.set("file", new File([JSON.stringify(f)], "b.json", { type: "application/json" }));
    const res = await checkBackup({}, fd);
    expect(res.result?.ok).toBe(true);
    expect((await getExtras().countAll()).counts).toEqual(before.counts);
    expect((await checkBackup({}, new FormData())).error).toMatch(/Pick a backup file/);
  });
});

describe("tables whose SQL is not run yet", () => {
  it("recognises missing-table errors from Supabase", () => {
    expect(isNotSetUp({ code: "PGRST205", message: "Could not find the table 'public.backup_log' in the schema cache" })).toBe(true);
    expect(isNotSetUp({ code: "42P01", message: 'relation "x" does not exist' })).toBe(true);
    expect(isNotSetUp({ code: "42501", message: "permission denied" })).toBe(false);
    expect(isNotSetUp(null)).toBe(false);
  });
});

describe("Supabase backups before and after the SQL is run", async () => {
  const { SupabaseExtrasStore } = await import("@/lib/data/extras");
  const { fakeClient, fakeDb } = await import("./fake-supabase");
  const store = (db: ReturnType<typeof fakeDb>) => new SupabaseExtrasStore(async () => fakeClient(db) as never);

  it("skips optional tables that do not exist yet and lists them", async () => {
    const db = fakeDb({ expenses: [{ id: "e1" }], profiles: [{ id: "u1", name: "Vivek" }] }, ["gap_answers", "backup_log", "activity_log"]);
    const dump = await store(db).dumpAll();
    expect(dump.tables.expenses).toHaveLength(1);
    expect(dump.missing).toEqual(expect.arrayContaining(["gap_answers", "backup_log", "activity_log"]));
    expect(dump.tables.gap_answers).toBeUndefined();
  });

  it("fails loudly if a core table is missing", async () => {
    await expect(store(fakeDb({}, ["expenses"])).dumpAll()).rejects.toThrow(/Could not read expenses/);
  });

  it("history says not switched on, and logging is skipped quietly, until backup_log exists", async () => {
    const db = fakeDb({}, ["backup_log"]);
    expect(await store(db).listBackups(5)).toEqual({ ready: false });
    expect(await store(db).logBackup({ takenBy: "u1", format: "json", totalRows: 1, counts: {} })).toBe(false);
  });

  it("records a download once the table exists", async () => {
    const db = fakeDb({ backup_log: [], profiles: [{ id: "u1", name: "Vivek" }] });
    expect(await store(db).logBackup({ takenBy: "u1", format: "json", totalRows: 3, counts: { a: 3 } })).toBe(true);
    expect(db.inserted.backup_log[0]).toMatchObject({ format: "json", total_rows: 3, taken_by: "u1" });
  });
});
