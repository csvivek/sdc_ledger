import { beforeEach, describe, expect, it, vi } from "vitest";
import { ADMIN, form, resetStore } from "./helpers";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAdmin: vi.fn(async () => ADMIN), requireUser: vi.fn(async () => ADMIN), SESSION_COOKIE: "t" }));

const auth = await import("@/lib/auth");
const { getStore } = await import("@/lib/data/store");
const { changeExpenseCategory } = await import("@/app/actions");
const { categoriseDebit } = await import("@/app/import/actions");

beforeEach(resetStore);

async function firstExpense(notCategory = "Rent") {
  const d = await getStore().read();
  return d.expenses.find((e) => e.category !== notCategory)!;
}

describe("changeExpenseCategory", () => {
  it("moves an expense to another category and records who, when and from what", async () => {
    const e = await firstExpense("Rent");
    const res = await changeExpenseCategory({}, form({ id: e.id, category: "Rent" }));
    expect(res.ok).toBe(`Changed from ${e.category} to Rent.`);

    const after = (await getStore().read()).expenses.find((x) => x.id === e.id)!;
    expect(after.category).toBe("Rent");
    expect(after.amount).toBe(e.amount); // nothing else changes

    const hist = await getStore().categoryChanges("expense", [e.id]);
    expect(hist).toHaveLength(1);
    expect(hist[0]).toMatchObject({ target: "expense", targetId: e.id, oldValue: e.category, newValue: "Rent", changedBy: ADMIN.id });
  });

  it("does not record anything when the category is the same", async () => {
    const e = await firstExpense();
    const res = await changeExpenseCategory({}, form({ id: e.id, category: e.category }));
    expect(res.ok).toMatch(/already/);
    expect(await getStore().categoryChanges("expense", [e.id])).toEqual([]);
  });

  it("keeps the newest change first", async () => {
    const e = await firstExpense("Rent");
    await changeExpenseCategory({}, form({ id: e.id, category: "Rent" }));
    await new Promise((r) => setTimeout(r, 5));
    await changeExpenseCategory({}, form({ id: e.id, category: "Miscellaneous" }));
    const hist = await getStore().categoryChanges("expense", [e.id]);
    expect(hist.map((h) => `${h.oldValue}>${h.newValue}`)).toEqual(["Rent>Miscellaneous", `${e.category}>Rent`]);
  });

  it("refuses an unknown category or expense", async () => {
    const e = await firstExpense();
    expect((await changeExpenseCategory({}, form({ id: e.id, category: "Nope" }))).error).toMatch(/Pick a category/);
    expect((await changeExpenseCategory({}, form({ id: "missing", category: "Rent" }))).error).toMatch(/not found/);
  });

  it("is admin only", async () => {
    vi.mocked(auth.requireAdmin).mockRejectedValueOnce(new Error("NEXT_REDIRECT"));
    const e = await firstExpense("Rent");
    await expect(changeExpenseCategory({}, form({ id: e.id, category: "Rent" }))).rejects.toThrow();
    expect((await getStore().read()).expenses.find((x) => x.id === e.id)!.category).toBe(e.category);
  });

  it("flows into the month's totals by category", async () => {
    const { expensesByCategory, monthOf } = await import("@/lib/calc");
    const e = await firstExpense("Rent");
    const month = monthOf(e.date);
    const before = expensesByCategory(await getStore().read(), month);
    await changeExpenseCategory({}, form({ id: e.id, category: "Rent" }));
    const after = expensesByCategory(await getStore().read(), month);
    const get = (rows: typeof before, cat: string) => rows.find(([c]) => c === cat)?.[1] ?? 0;
    expect(get(after, "Rent") - get(before, "Rent")).toBe(e.amount);
  });
});

describe("bank payment changes are recorded", () => {
  const answer = (id: string, choice: string) => form({ id, choice, clinic: "SHARED" });

  it("records a change to a decided payment, but not a first answer", async () => {
    await getStore().importBank(
      [{ date: "2026-10-05", narration: "NEFT-KOVAI BIO WASTE", refNo: "R1", valueDate: "2026-10-05", withdrawal: 1500, deposit: 0, balance: 1, kind: "UNKNOWN_OUT", fingerprint: "fp-bio" }],
      { fileName: "t.xls", importedBy: ADMIN.id },
    );
    const t = (await getStore().read()).bankTxns.find((x) => x.fingerprint === "fp-bio")!;

    // First answer to a waiting payment: not a change.
    expect((await categoriseDebit({}, answer(t.id, "EXPENSE:Rent"))).saved).toBe(true);
    expect(await getStore().categoryChanges("bank", [t.id])).toEqual([]);

    // Correcting it later is recorded.
    expect((await categoriseDebit({}, answer(t.id, "EXPENSE:Miscellaneous"))).saved).toBe(true);
    // Saving the same answer again adds nothing.
    expect((await categoriseDebit({}, answer(t.id, "EXPENSE:Miscellaneous"))).saved).toBe(true);
    // Turning it into a transfer is recorded in words.
    await new Promise((r) => setTimeout(r, 5));
    expect((await categoriseDebit({}, answer(t.id, "TRANSFER_OUT"))).saved).toBe(true);

    const hist = await getStore().categoryChanges("bank", [t.id]);
    expect(hist.map((h) => `${h.oldValue}>${h.newValue}`)).toEqual(["Miscellaneous>Transfer (not an expense)", "Rent>Miscellaneous"]);
    expect(hist[0].changedBy).toBe(ADMIN.id);
  });
});
