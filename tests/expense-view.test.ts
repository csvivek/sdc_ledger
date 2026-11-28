import { beforeEach, describe, expect, it } from "vitest";
import { getStore } from "@/lib/data/store";
import {
  entriesHref,
  entryTotals,
  filterByClinic,
  isMonthKey,
  monthOptions,
  monthRange,
  pickClinic,
  pickView,
  shiftMonth,
} from "@/lib/expense-view";
import type { Expense } from "@/lib/types";
import { resetStore } from "./helpers";

const exp = (over: Partial<Expense>): Expense => ({
  id: "e",
  date: "2026-11-10",
  amount: 100,
  category: "Flowers",
  clinic: "SDC1",
  paidBy: "PETTY_CASH",
  note: "",
  enteredBy: "u1",
  enteredAt: "2026-11-10T05:00:00Z",
  ...over,
});

describe("month helpers", () => {
  it("shifts across year ends", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2025-12", 1)).toBe("2026-01");
    expect(shiftMonth("2026-11", -15)).toBe("2025-08");
  });

  it("gives a date range for the month", () => {
    expect(monthRange("2026-12")).toEqual({ from: "2026-12-01", to: "2027-01-01" });
    expect(monthRange("2026-02")).toEqual({ from: "2026-02-01", to: "2026-03-01" });
  });

  it("checks month keys", () => {
    expect(isMonthKey("2026-11")).toBe(true);
    expect(isMonthKey("2026-13")).toBe(false);
    expect(isMonthKey("2026-1")).toBe(false);
    expect(isMonthKey("latest")).toBe(false);
    expect(isMonthKey(undefined)).toBe(false);
  });
});

describe("monthOptions", () => {
  it("lists months newest first, from the first entry to now", () => {
    expect(monthOptions("2025-10-03", "2026-01")).toEqual(["2026-01", "2025-12", "2025-11", "2025-10"]);
  });

  it("is just the current month with no entries, or a future-dated first entry", () => {
    expect(monthOptions(undefined, "2026-11")).toEqual(["2026-11"]);
    expect(monthOptions("2027-02-01", "2026-11")).toEqual(["2026-11"]);
  });
});

describe("pickView and pickClinic", () => {
  const months = ["2026-11", "2026-10"];
  it("shows the latest entries unless a listed month is asked for", () => {
    expect(pickView(undefined, months)).toBe("latest");
    expect(pickView("2026-10", months)).toBe("2026-10");
    expect(pickView("2020-01", months)).toBe("latest");
    expect(pickView("junk", months)).toBe("latest");
  });

  it("falls back to all clinics", () => {
    expect(pickClinic("SDC2")).toBe("SDC2");
    expect(pickClinic("SHARED")).toBe("SHARED");
    expect(pickClinic("SDC9")).toBe("ALL");
    expect(pickClinic(undefined)).toBe("ALL");
  });

  it("builds links that leave out the defaults", () => {
    expect(entriesHref("latest", "ALL")).toBe("/expenses#entries");
    expect(entriesHref("2026-10", "ALL")).toBe("/expenses?view=2026-10#entries");
    expect(entriesHref("2026-10", "SDC1")).toBe("/expenses?view=2026-10&clinic=SDC1#entries");
  });
});

describe("totals and clinic filter", () => {
  const list = [
    exp({ id: "a", clinic: "SDC1", amount: 100 }),
    exp({ id: "b", clinic: "SDC2", amount: 250 }),
    exp({ id: "c", clinic: "SHARED", amount: 1000 }),
    exp({ id: "d", clinic: "SDC1", amount: 50 }),
  ];

  it("adds up per clinic, keeping Shared on its own", () => {
    expect(entryTotals(list)).toEqual({ total: 1400, count: 4, byClinic: { SDC1: 150, SDC2: 250, SHARED: 1000 } });
    expect(entryTotals([])).toEqual({ total: 0, count: 0, byClinic: { SDC1: 0, SDC2: 0, SHARED: 0 } });
  });

  it("filters by clinic", () => {
    expect(filterByClinic(list, "ALL")).toHaveLength(4);
    expect(filterByClinic(list, "SDC1").map((e) => e.id)).toEqual(["a", "d"]);
    expect(filterByClinic(list, "SHARED").map((e) => e.id)).toEqual(["c"]);
  });
});

describe("store: monthExpenses and firstExpenseDate", () => {
  beforeEach(resetStore);

  it("returns only entries dated in the month, newest date first", async () => {
    const store = getStore();
    const base = { category: "Flowers", clinic: "SDC1" as const, paidBy: "PETTY_CASH" as const, note: "", enteredBy: "u1" };
    await store.addExpense({ ...base, date: "2031-03-31", amount: 3 });
    await store.addExpense({ ...base, date: "2031-03-01", amount: 1 });
    await store.addExpense({ ...base, date: "2031-04-01", amount: 99 });
    await store.addExpense({ ...base, date: "2031-02-28", amount: 98 });
    // Typed in last, but dated mid-month: sorts by its date, not by when it was typed.
    await store.addExpense({ ...base, date: "2031-03-15", amount: 2 });

    const r = await store.monthExpenses("2031-03", 100);
    expect(r.expenses.map((e) => e.amount)).toEqual([3, 2, 1]);
    expect(r.more).toBe(false);

    const capped = await store.monthExpenses("2031-03", 2);
    expect(capped.expenses.map((e) => e.amount)).toEqual([3, 2]);
    expect(capped.more).toBe(true);

    expect((await store.monthExpenses("2031-05", 100)).expenses).toEqual([]);
  });

  it("finds the oldest entry date", async () => {
    const store = getStore();
    const d = await store.read();
    const oldest = d.expenses.map((e) => e.date).sort()[0];
    expect(await store.firstExpenseDate()).toBe(oldest);
    await store.addExpense({ date: "2001-01-05", amount: 1, category: "Flowers", clinic: "SDC2", paidBy: "PETTY_CASH", note: "", enteredBy: "u1" });
    expect(await store.firstExpenseDate()).toBe("2001-01-05");
  });
});
