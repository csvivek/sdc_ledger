import { beforeEach, describe, expect, it, vi } from "vitest";
import { ADMIN, form, resetStore } from "./helpers";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAdmin: vi.fn(async () => ADMIN), requireUser: vi.fn(async () => ADMIN) }));

const { getStore } = await import("@/lib/data/store");
const { savePettyCount, deletePettyCount } = await import("@/app/petty-cash/actions");
const { pettyCashAllTime, pettyCashMonth } = await import("@/lib/calc");
const { reconcileMonth } = await import("@/lib/recon");
const { OTHER_REASON } = await import("@/lib/petty");

// The sample data has petty cash in Sep, Oct and Nov 2026.
const OCT = "2026-10";
const NOV = "2026-11";

const read = () => getStore().read();
const expectedFor = async (month: string) => pettyCashMonth(await read(), "SDC1", month).expected;
const count = (o: Record<string, string>) => form({ clinic: "SDC1", month: OCT, ...o });

beforeEach(resetStore);

describe("savePettyCount", () => {
  it("saves a count that matches without asking why", async () => {
    const expected = await expectedFor(OCT);
    const res = await savePettyCount({}, count({ counted: String(expected) }));
    expect(res.ok).toMatch(/matches/);
    const d = await read();
    expect(d.pettyCounts).toHaveLength(1);
    expect(d.pettyCounts[0]).toMatchObject({ clinic: "SDC1", month: OCT, counted: expected, countedBy: ADMIN.id });
    expect(pettyCashMonth(d, "SDC1", OCT).difference).toBe(0);
  });

  it("asks why when the count differs, and the count becomes next month's carry-in", async () => {
    const expected = await expectedFor(OCT);
    const counted = expected - 200;
    const noReason = await savePettyCount({}, count({ counted: String(counted) }));
    expect(noReason.error).toMatch(/₹200 less than expected/);
    expect((await read()).pettyCounts).toHaveLength(0);

    const reasonId = (await read()).pettyCountReasons[0].id;
    const res = await savePettyCount({}, count({ counted: String(counted), reason: reasonId, note: "flowers bill" }));
    expect(res.ok).toMatch(/₹200 less/);

    const d = await read();
    const oct = pettyCashMonth(d, "SDC1", OCT);
    expect(oct).toMatchObject({ expected, difference: -200, leftAtEnd: counted });
    expect(pettyCashMonth(d, "SDC1", NOV).carriedIn).toBe(counted);
    // The other clinic is not touched.
    expect(pettyCashMonth(d, "SDC2", OCT).count).toBeUndefined();
  });

  it("keeps the adjustment visible: all time = movements + count differences = latest month end", async () => {
    const expected = await expectedFor(OCT);
    const reasonId = (await read()).pettyCountReasons[0].id;
    await savePettyCount({}, count({ counted: String(expected + 150), reason: reasonId }));
    const d = await read();
    const all = pettyCashAllTime(d, "SDC1");
    expect(all.adjusted).toBe(150);
    expect(all.balance).toBeCloseTo(pettyCashMonth(d, "SDC1", "2026-12").carriedIn, 6);
    expect(all.balance).toBeCloseTo(all.opening + all.totalIn - all.totalOut + 150, 6);
  });

  it("shows the count on Reconcile", async () => {
    const expected = await expectedFor(OCT);
    const reasonId = (await read()).pettyCountReasons[0].id;
    await savePettyCount({}, count({ counted: String(expected - 50), reason: reasonId }));
    const r = reconcileMonth(await read(), OCT);
    expect(r.petty.SDC1).toMatchObject({ expected, counted: expected - 50, difference: -50, closing: expected - 50 });
    expect(reconcileMonth(await read(), NOV).petty.SDC1.opening).toBe(expected - 50);
  });

  it("adds a typed reason to the list, and reuses the same text instead of adding it twice", async () => {
    const expected = await expectedFor(OCT);
    const before = (await read()).pettyCountReasons.length;
    const first = await savePettyCount(
      {},
      count({ counted: String(expected - 10), reason: OTHER_REASON, otherReason: "Coins given  for parking" }),
    );
    expect(first.ok).toMatch(/added to the list/);
    let d = await read();
    expect(d.pettyCountReasons).toHaveLength(before + 1);
    const added = d.pettyCountReasons.at(-1)!;
    expect(added.label).toBe("Coins given for parking");
    expect(d.pettyCounts[0].reasonId).toBe(added.id);

    const again = await savePettyCount(
      {},
      count({ id: d.pettyCounts[0].id, counted: String(expected - 20), reason: OTHER_REASON, otherReason: "coins GIVEN for parking" }),
    );
    expect(again.ok).toMatch(/already in the list/);
    d = await read();
    expect(d.pettyCountReasons).toHaveLength(before + 1);
    expect(d.pettyCounts[0]).toMatchObject({ counted: expected - 20, reasonId: added.id });
  });

  it("softly declines a second count for the same clinic and month, but allows editing it", async () => {
    const expected = await expectedFor(OCT);
    await savePettyCount({}, count({ counted: String(expected) }));
    const dup = await savePettyCount({}, count({ counted: String(expected) }));
    expect(dup.notice).toMatch(/already counted/);
    expect(dup.error).toBeUndefined();

    const id = (await read()).pettyCounts[0].id;
    const reasonId = (await read()).pettyCountReasons[0].id;
    const edit = await savePettyCount({}, count({ id, counted: String(expected + 5), reason: reasonId }));
    expect(edit.ok).toMatch(/Count saved/);
    const d = await read();
    expect(d.pettyCounts).toHaveLength(1);
    expect(d.pettyCounts[0]).toMatchObject({ id, counted: expected + 5 });
  });

  it.each([
    [{ counted: "" }, /Type the cash/],
    [{ counted: "abc" }, /in rupees/],
    [{ counted: "-5" }, /in rupees/],
    [{ counted: "12.345" }, /in rupees/],
    [{ counted: "2000000" }, /more than/],
    [{ counted: "100", clinic: "SHARED" }, /Pick a clinic/],
    [{ counted: "100", month: "2026-13" }, /Pick a month/],
    [{ counted: "100", month: "2099-01" }, /not started/],
    [{ counted: "100", reason: "no-such-reason" }, /reason from the list/],
    [{ counted: "100", reason: OTHER_REASON, otherReason: "x" }, /3 to 120/],
  ])("refuses %o", async (fields, message) => {
    const res = await savePettyCount({}, count(fields));
    expect(res.error).toMatch(message);
    expect((await read()).pettyCounts).toHaveLength(0);
  });

  it("accepts amounts typed with ₹ and commas", async () => {
    const expected = await expectedFor(OCT);
    const typed = "₹" + expected.toLocaleString("en-IN");
    const res = await savePettyCount({}, count({ counted: typed }));
    expect(res.ok).toMatch(/matches/);
  });
});

describe("deletePettyCount", () => {
  it("removes the count, so the month ends on the expected balance again", async () => {
    const expected = await expectedFor(OCT);
    const reasonId = (await read()).pettyCountReasons[0].id;
    await savePettyCount({}, count({ counted: String(expected - 300), reason: reasonId }));
    const id = (await read()).pettyCounts[0].id;
    expect((await deletePettyCount({}, form({ id }))).ok).toMatch(/removed/);
    const d = await read();
    expect(d.pettyCounts).toHaveLength(0);
    expect(pettyCashMonth(d, "SDC1", NOV).carriedIn).toBe(expected);
    expect((await deletePettyCount({}, form({ id }))).error).toMatch(/already removed/);
  });
});

describe("petty count in a closed month", () => {
  it("is refused with the closed-month message, for a new count, an edit and a removal", async () => {
    const { getExtras } = await import("@/lib/data/extras");
    const expected = await expectedFor(OCT);
    const saved = await savePettyCount({}, count({ counted: String(expected) }));
    expect(saved.ok).toBeTruthy();
    const id = (await read()).pettyCounts[0].id;
    await getExtras().closeMonth(OCT, [], "test", ADMIN.id);
    try {
      expect((await savePettyCount({}, count({ counted: String(expected), id }))).error).toMatch(/Oct 2026 is closed/);
      expect((await savePettyCount({}, form({ clinic: "SDC2", month: OCT, counted: "1" }))).error).toMatch(/is closed/);
      expect((await deletePettyCount({}, form({ id }))).error).toMatch(/is closed/);
      expect((await read()).pettyCounts).toMatchObject([{ id, counted: expected }]);
    } finally {
      await getExtras().reopenMonth(OCT, "test over", ADMIN.id);
    }
  });
});
