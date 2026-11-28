import { beforeEach, describe, expect, it, vi } from "vitest";
import { ADMIN, form, resetStore } from "./helpers";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAdmin: vi.fn(async () => ADMIN), requireUser: vi.fn(async () => ADMIN), SESSION_COOKIE: "t" }));
vi.mock("@/lib/calc", async (orig) => ({ ...(await orig<typeof import("@/lib/calc")>()), todayInIndia: () => "2026-11-28" }));

const { getStore } = await import("@/lib/data/store");
const { getExtras, SupabaseExtrasStore } = await import("@/lib/data/extras");
const r = await import("@/lib/recurring");
const { saveTemplateAction, toggleTemplateAction, addRecurringAction, addAllRecurringAction } = await import("@/app/recurring/actions");
const { closeMonthAction } = await import("@/app/month-close/actions");
const { matches } = await import("@/lib/recon");
const { fakeClient, fakeDb } = await import("./fake-supabase");

beforeEach(resetStore);

const rent = { label: "Rent SDC 1", category: "Rent", clinic: "SDC1", paidBy: "BANK", amount: "45000", dayOfMonth: "1", note: "" };
const salary = { label: "Salary Assistant A", category: "Salary", payeeId: "payee_staff_1", clinic: "SDC1", paidBy: "BANK", amount: "15000", dayOfMonth: "31", note: "" };

async function addTemplate(f: Record<string, string>) {
  const s = await saveTemplateAction({}, form(f));
  expect(s.error).toBeUndefined();
  const list = await getExtras().listTemplates();
  return list.ready ? list.value.find((t) => t.label === f.label)! : (undefined as never);
}

const recurringIn = async (month: string) => (await getStore().read()).expenses.filter((e) => e.recurringMonth === month);

describe("recurring templates", () => {
  it("checks the template: payee needed, invoice categories refused, duplicate names softly declined", async () => {
    const opts = await getStore().formOptions();
    expect(r.checkTemplate({ ...salary, payeeId: "" }, opts, [])).toBe("Pick who is paid.");
    expect(r.checkTemplate({ ...rent, category: "Lab" }, opts, [])).toMatch(/invoice number every time/);
    expect(r.checkTemplate({ ...rent, dayOfMonth: "32" }, opts, [])).toMatch(/1 to 31/);
    expect(r.checkTemplate({ ...rent, paidBy: "PETTY_CASH", clinic: "SHARED" }, opts, [])).toMatch(/petty cash pays/);
    const ok = r.checkTemplate({ ...rent, paidBy: "PETTY_CASH" }, opts, []);
    expect(ok).toMatchObject({ pettyCashClinic: "SDC1", amount: 45000 });

    await addTemplate(rent);
    const again = await saveTemplateAction({}, form({ ...rent, label: "  rent   sdc 1 " }));
    expect(again.error).toMatch(/already in the list/);
  });

  it("uses the last day in short months", () => {
    expect(r.dateFor({ dayOfMonth: 31 }, "2026-02")).toBe("2026-02-28");
    expect(r.dateFor({ dayOfMonth: 31 }, "2026-11")).toBe("2026-11-30");
    expect(r.dateFor({ dayOfMonth: 5 }, "2026-12")).toBe("2026-12-05");
  });

  it("edits a template and hides it; a hidden one no longer shows in new months", async () => {
    const t = await addTemplate(rent);
    expect((await saveTemplateAction({}, form({ ...rent, id: t.id, amount: "47000" }))).ok).toMatch(/Saved changes/);
    await toggleTemplateAction(form({ id: t.id, active: "0" }));
    const list = await getExtras().listTemplates();
    expect(list.ready && list.value[0]).toMatchObject({ amount: 47000, active: false });
    expect(r.monthItems(list.ready ? list.value : [], "2026-12", [])).toEqual([]);
  });
});

describe("adding for a month", () => {
  it("one tap adds a normal expense with the edited amount, and never twice for the same month", async () => {
    const t = await addTemplate(rent);
    const s = await addRecurringAction({}, form({ month: "2026-12", id: t.id, amount: "46000", date: "2026-12-02" }));
    expect(s.ok).toMatch(/Added Rent SDC 1: ₹46,000/);
    const [e] = await recurringIn("2026-12");
    expect(e).toMatchObject({ amount: 46000, date: "2026-12-02", category: "Rent", clinic: "SDC1", paidBy: "BANK", recurringId: t.id, note: "Rent SDC 1", inPappyJoe: "NA" });

    const twice = await addRecurringAction({}, form({ month: "2026-12", id: t.id, amount: "46000", date: "2026-12-02" }));
    expect(twice.error).toMatch(/already added for Dec 2026/);
    expect(await recurringIn("2026-12")).toHaveLength(1);
    // Next month is separate.
    expect((await addRecurringAction({}, form({ month: "2027-01", id: t.id, amount: "45000", date: "2027-01-01" }))).ok).toBeTruthy();
  });

  it("refuses a date outside the month and a bad amount", async () => {
    const t = await addTemplate(rent);
    expect((await addRecurringAction({}, form({ month: "2026-12", id: t.id, amount: "45000", date: "2027-01-01" }))).error).toMatch(/date in Dec 2026/);
    expect((await addRecurringAction({}, form({ month: "2026-12", id: t.id, amount: "0", date: "2026-12-01" }))).error).toMatch(/amount/);
  });

  it("Add all adds the rest at usual amounts, skipping hand-typed lookalikes and ones already added", async () => {
    // The seed already has a hand-typed ₹45,000 Rent SDC1 bank entry in November.
    const t1 = await addTemplate(rent);
    await addTemplate({ ...rent, label: "Rent SDC 2", clinic: "SDC2", amount: "38000" });
    const t3 = await addTemplate(salary);
    const list = await getExtras().listTemplates();
    const items = r.monthItems(list.ready ? list.value : [], "2026-11", (await getStore().read()).expenses);
    expect(items.find((i) => i.template.id === t1.id)!.lookalike).toBeTruthy();
    expect(items.find((i) => i.template.id === t3.id)!.date).toBe("2026-11-30");

    const s = await addAllRecurringAction({}, form({ month: "2026-11" }));
    expect(s.ok).toMatch(/Added 1 for Nov 2026, ₹15,000 in all/);
    expect(s.ok).toMatch(/2 skipped because a matching entry was already typed by hand/);
    expect((await recurringIn("2026-11")).map((e) => e.recurringId)).toEqual([t3.id]);
    expect((await addAllRecurringAction({}, form({ month: "2026-11" }))).ok).toMatch(/Nothing to add/);

    // December has no hand-typed entries yet: all three go in.
    const dec = await addAllRecurringAction({}, form({ month: "2026-12" }));
    expect(dec.ok).toMatch(/Added 3 for Dec 2026, ₹98,000 in all/);
    expect(await recurringIn("2026-12")).toHaveLength(3);
  });

  it("matches the bank debit through the normal reconciliation", async () => {
    const t = await addTemplate(rent);
    const store = getStore();
    await store.importBank(
      [{ date: "2026-12-03", narration: "NEFT RENT PODANUR", refNo: "", valueDate: "2026-12-03", withdrawal: 45000, deposit: 0, balance: 0, kind: "EXPENSE", category: "Rent", fingerprint: "rent-dec" }],
      { fileName: "x", importedBy: "admin" },
    );
    await addRecurringAction({}, form({ month: "2026-12", id: t.id, amount: "45000", date: "2026-12-01" }));
    const d = await store.read();
    const [e] = d.expenses.filter((x) => x.recurringMonth === "2026-12");
    expect(matches(d).expenseMatched.has(e.id)).toBe(true);
  });

  it("refuses a closed month", async () => {
    const t = await addTemplate(rent);
    await closeMonthAction({}, form({ month: "2026-10", force: "1", note: "closing for test" }));
    expect((await addRecurringAction({}, form({ month: "2026-10", id: t.id, amount: "45000", date: "2026-10-01" }))).error).toMatch(/closed/);
    expect((await addAllRecurringAction({}, form({ month: "2026-10" }))).error).toMatch(/closed/);
  });

  it("maps the database's unique-index refusal to 'already added'", () => {
    expect(r.isDuplicateRecurring(new Error('duplicate key value violates unique constraint "expenses_recurring_once"'))).toBe(true);
    expect(r.isDuplicateRecurring(new Error("MONTH_CLOSED:2026-10"))).toBe(false);
  });
});

describe("Supabase recurring before and after the SQL", () => {
  const store = (db: ReturnType<typeof fakeDb>) => new SupabaseExtrasStore(async () => fakeClient(db) as never);

  it("is 'not switched on' until the table exists, and reads templates after", async () => {
    expect(await store(fakeDb({}, ["recurring_templates"])).listTemplates()).toEqual({ ready: false });
    const db = fakeDb({
      recurring_templates: [{ id: "t1", label: "Rent SDC 1", category: "Rent", payee_id: null, clinic: "SDC1", paid_by: "BANK", petty_cash_clinic: null, amount: "45000.00", day_of_month: 1, note: "", active: true, sort_order: 100 }],
      expenses: [],
    });
    const list = await store(db).listTemplates();
    expect(list).toEqual({ ready: true, value: [expect.objectContaining({ id: "t1", amount: 45000, dayOfMonth: 1, payeeId: undefined })] });
  });

  it("sends a new template with snake_case columns", async () => {
    const db = fakeDb({ recurring_templates: [] });
    await store(db).saveTemplate({ label: "EB SDC 2", category: "EB", clinic: "SDC2", paidBy: "UPI", amount: 3200, dayOfMonth: 10, note: "" });
    expect(db.inserted.recurring_templates[0]).toMatchObject({ label: "EB SDC 2", paid_by: "UPI", day_of_month: 10, payee_id: null, petty_cash_clinic: null });
  });
});
