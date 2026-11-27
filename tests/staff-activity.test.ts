import { beforeEach, describe, expect, it, vi } from "vitest";
import { form, resetStore } from "./helpers";

const ME = { id: "admin", name: "Doctor (Admin)", role: "admin" as const };
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAdmin: vi.fn(async () => ME), requireUser: vi.fn(async () => ME), SESSION_COOKIE: "t" }));

const { getExtras, SupabaseExtrasStore, LastAdminError } = await import("@/lib/data/extras");
const { savePerson } = await import("@/app/staff/actions");
const { addExpense, addCategoryAdmin, renameCategoryAdmin } = await import("@/app/actions");
const act = await import("@/lib/activity");
const { fakeClient, fakeDb } = await import("./fake-supabase");

beforeEach(resetStore);

const person = (id: string, f: Record<string, string>) => form({ id, name: "X", role: "staff", clinic: "", active: "1", ...f });

describe("staff logins", () => {
  it("renames a person and sets their home clinic", async () => {
    const res = await savePerson({}, person("staff1", { name: "Priya  K", clinic: "SDC1" }));
    expect(res.ok).toBe("Saved Priya K.");
    const p = (await getExtras().listPeople()).people.find((x) => x.id === "staff1")!;
    expect(p).toMatchObject({ name: "Priya K", clinic: "SDC1", role: "staff", active: true });
  });

  it("switches a login off, which then cannot be picked at login", async () => {
    const res = await savePerson({}, person("staff2", { name: "Front desk, SDC 2", clinic: "SDC2", active: "0" }));
    expect(res.ok).toMatch(/can no longer log in/);
    expect((await getExtras().listPeople()).people.find((x) => x.id === "staff2")!.active).toBe(false);
  });

  it("will not let you switch yourself off or drop your own admin role", async () => {
    expect((await savePerson({}, person("admin", { role: "admin", active: "0" }))).error).toMatch(/cannot switch off your own login/);
    expect((await savePerson({}, person("admin", { role: "staff" }))).error).toMatch(/cannot remove your own admin role/);
  });

  it("never leaves the clinic without an active admin", async () => {
    // Demote via the store directly (the action already refuses self-changes).
    await expect(getExtras().updatePerson("admin", { name: "Doctor", role: "staff", active: true })).rejects.toBeInstanceOf(LastAdminError);
    // With a second admin, the first can be changed.
    await getExtras().updatePerson("staff1", { name: "Second admin", role: "admin", active: true });
    await getExtras().updatePerson("admin", { name: "Doctor", role: "staff", active: true });
  });

  it("checks the input", async () => {
    expect((await savePerson({}, person("staff1", { name: "  " }))).error).toMatch(/Type the person's name/);
    expect((await savePerson({}, person("staff1", { role: "boss" }))).error).toMatch(/Pick admin or staff/);
    expect((await savePerson({}, person("nobody", {}))).error).toMatch(/not found/);
  });
});

describe("activity log (fake-data mode)", () => {
  it("records who added an expense, renamed a category and changed a login, newest first", async () => {
    await addExpense({}, form({ amount: "450", category: "Flowers", clinic: "SDC1", paidBy: "PETTY_CASH", date: "2026-11-20", note: "", inPappyJoe: "NA" }));
    await addCategoryAdmin({}, form({ name: "Water cans" }));
    await renameCategoryAdmin({}, form({ oldName: "Water cans", name: "Drinking water" }));
    await savePerson({}, person("staff1", { name: "Priya", clinic: "SDC1" }));
    const log = await getExtras().listActivity({ limit: 10 });
    expect(log.ready).toBe(true);
    const rows = log.ready ? log.value : [];
    expect(rows.map((e) => `${e.action} ${e.entity}`)).toEqual(["change profiles", "change categories", "add categories", "add expenses"]);
    expect(rows.every((e) => e.actorName === "Doctor (Admin)")).toBe(true);
    expect(act.describeActivity(rows[3])).toBe("₹450 · Flowers · SDC1 · 2026-11-20");
    expect(act.describeActivity(rows[1])).toBe("Drinking water — name: Water cans → Drinking water");
    expect(act.describeActivity(rows[0])).toMatch(/name: Front desk, SDC 1 → Priya/);
  });

  it("filters by person and kind, and pages to older entries", async () => {
    for (let i = 0; i < 3; i++) await addCategoryAdmin({}, form({ name: `Cat ${i}` }));
    const x = getExtras();
    expect((await x.listActivity({ limit: 10, entity: "expenses" })).ready && (await x.listActivity({ limit: 10, entity: "expenses" }))).toMatchObject({ value: [] });
    const first = await x.listActivity({ limit: 2 });
    const page1 = first.ready ? first.value : [];
    expect(page1).toHaveLength(2);
    const older = await x.listActivity({ limit: 2, before: page1[1].id });
    expect(older.ready && older.value.map((e) => e.after?.name)).toEqual(["Cat 0"]);
    expect((await x.listActivity({ limit: 10, actorId: "staff1" })).ready).toBe(true);
  });
});

describe("describing database log rows", () => {
  const base = { id: "1", at: "2026-11-28T04:00:00Z", actorId: "u1" };
  it("reads Supabase rows (snake_case) for each kind of change", () => {
    expect(act.describeActivity({ ...base, action: "change", entity: "bank_transactions", before: { kind: "UNKNOWN_OUT", category: null, narration: "ACME", txn_date: "2026-10-02" }, after: { kind: "EXPENSE", category: "Lab" } })).toBe(
      "ACME · 2026-10-02 — type: UNKNOWN_OUT → EXPENSE; category: empty → Lab",
    );
    expect(act.describeActivity({ ...base, action: "delete", entity: "bank_rules", before: { pattern: "ZAHN ARTZ" } })).toBe("ZAHN ARTZ");
    expect(act.describeActivity({ ...base, action: "add", entity: "import_batches", after: { file_name: "oct.xls", source: "HDFC", rows_added: 120 } })).toBe("oct.xls · HDFC · 120 rows added");
    expect(act.describeActivity({ ...base, action: "change", entity: "profiles", before: { active: true, name: "Priya" }, after: { active: false } })).toBe("Priya — on/off: on → off");
  });
  it("says when a change came from the SQL editor", () => {
    expect(act.actorLabel({ ...base, actorId: undefined, action: "add", entity: "expenses" })).toBe("Database (SQL editor)");
  });
});

describe("Supabase staff and activity before and after the SQL", () => {
  const store = (db: ReturnType<typeof fakeDb>) => new SupabaseExtrasStore(async () => fakeClient(db) as never);

  it("lists people without last sign-in until admin_login_info exists", async () => {
    const db = fakeDb({ profiles: [{ id: "u1", name: "Vivek", role: "admin", email: "v@x" }] });
    const r = await store(db).listPeople();
    expect(r.loginInfo).toBe(false);
    expect(r.people[0]).toMatchObject({ name: "Vivek", active: true, email: "v@x" });
  });

  it("shows last sign-in once the function exists", async () => {
    const db = fakeDb({ profiles: [{ id: "u1", name: "Vivek", role: "admin", active: true }] });
    db.rpcResult = () => ({ data: [{ id: "u1", email: "v@x", last_sign_in_at: "2026-11-27T10:00:00Z" }], error: null });
    const r = await store(db).listPeople();
    expect(r.loginInfo).toBe(true);
    expect(r.people[0].lastSignIn).toBe("2026-11-27T10:00:00Z");
  });

  it("activity says not switched on until the table exists", async () => {
    expect(await store(fakeDb({}, ["activity_log"])).listActivity({ limit: 5 })).toEqual({ ready: false });
    const db = fakeDb({ activity_log: [{ id: 7, at: "2026-11-28T00:00:00Z", actor: "u1", action: "add", entity: "expenses", after: { amount: 5 } }], profiles: [{ id: "u1", name: "Vivek" }] });
    const r = await store(db).listActivity({ limit: 5 });
    expect(r.ready && r.value[0]).toMatchObject({ id: "7", actorName: "Vivek", action: "add" });
  });
});
