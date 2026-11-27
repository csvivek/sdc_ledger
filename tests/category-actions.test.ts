import { beforeEach, describe, expect, it, vi } from "vitest";
import { ADMIN, form, resetStore } from "./helpers";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAdmin: vi.fn(async () => ADMIN), requireUser: vi.fn(async () => ADMIN), SESSION_COOKIE: "t" }));

const { getStore } = await import("@/lib/data/store");
const { addCategoryAdmin, renameCategoryAdmin, toggleCategoryActive } = await import("@/app/actions");

beforeEach(resetStore);
const names = async () => (await getStore().listCategories()).map((c) => `${c.name}${c.active ? "" : " (hidden)"}`);

describe("addCategoryAdmin", () => {
  it("adds a new category at the end, tidying spaces", async () => {
    const res = await addCategoryAdmin({}, form({ name: "  Water   cans " }));
    expect(res.ok).toMatch(/Added "Water cans"/);
    expect((await names()).at(-1)).toBe("Water cans");
    expect((await getStore().read()).categories).toContain("Water cans");
  });

  it("declines a duplicate in any case", async () => {
    const before = await names();
    const res = await addCategoryAdmin({}, form({ name: "rent" }));
    expect(res.error).toMatch(/"Rent" is already in the list/);
    expect(await names()).toEqual(before);
  });

  it("points to Show again when the duplicate is hidden", async () => {
    await toggleCategoryActive({}, form({ name: "Flowers", active: "0" }));
    const res = await addCategoryAdmin({}, form({ name: "FLOWERS" }));
    expect(res.error).toMatch(/hidden\. Use "Show again"/);
  });

  it("refuses empty and over-long names", async () => {
    expect((await addCategoryAdmin({}, form({ name: "   " }))).error).toMatch(/Type a name/);
    expect((await addCategoryAdmin({}, form({ name: "x".repeat(61) }))).error).toMatch(/under 60/);
  });
});

describe("renameCategoryAdmin", () => {
  it("renames, and old expenses and bank rules follow", async () => {
    const res = await renameCategoryAdmin({}, form({ oldName: "Lab", name: "Dental lab" }));
    expect(res.ok).toMatch(/Renamed to "Dental lab"/);
    const d = await getStore().read();
    expect(d.categories).toContain("Dental lab");
    expect(d.categories).not.toContain("Lab");
    expect(d.expenses.some((e) => e.category === "Lab")).toBe(false);
    expect(d.expenses.some((e) => e.category === "Dental lab")).toBe(true);
    expect(d.bankRules.find((r) => r.pattern === "ZAHN ARTZ")!.category).toBe("Dental lab");
    expect(d.invoiceCategories).toContain("Dental lab");
  });

  it("declines a name another category already has, any case", async () => {
    expect((await renameCategoryAdmin({}, form({ oldName: "Lab", name: "PHARMA" }))).error).toMatch(/"Pharma" already exists/);
  });

  it("allows changing only the case of its own name", async () => {
    expect((await renameCategoryAdmin({}, form({ oldName: "Flowers", name: "FLOWERS" }))).ok).toMatch(/Renamed/);
  });

  it("keeps Miscellaneous", async () => {
    expect((await renameCategoryAdmin({}, form({ oldName: "Miscellaneous", name: "Other" }))).error).toMatch(/keeps its name/);
  });

  it("reports a category that is gone", async () => {
    expect((await renameCategoryAdmin({}, form({ oldName: "Nope", name: "Other" }))).error).toMatch(/not found/);
  });
});

describe("toggleCategoryActive", () => {
  it("hides and shows a category; hidden ones are not offered", async () => {
    await toggleCategoryActive({}, form({ name: "Flowers", active: "0" }));
    expect((await getStore().read()).categories).not.toContain("Flowers");
    expect(await names()).toContain("Flowers (hidden)");
    await toggleCategoryActive({}, form({ name: "Flowers", active: "1" }));
    expect((await getStore().read()).categories).toContain("Flowers");
  });

  it("never hides Miscellaneous", async () => {
    expect((await toggleCategoryActive({}, form({ name: "Miscellaneous", active: "0" }))).error).toMatch(/cannot be hidden/);
    expect((await getStore().read()).categories).toContain("Miscellaneous");
  });
});
