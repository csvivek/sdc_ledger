import { beforeEach, describe, expect, it } from "vitest";
import { monthsWithData } from "@/lib/calc";
import { getStore } from "@/lib/data/store";
import { SEED_MONTHS } from "@/lib/data/seed";
import { reconcileMonth } from "@/lib/recon";
import {
  axisMonth,
  CHART_WINDOW_MONTHS,
  compactInr,
  monthsEndingAt,
  niceTicks,
  previewTrendRows,
  shouldShowCharts,
  trendRows,
} from "@/lib/trend";
import type { LedgerData } from "@/lib/types";
import { resetStore } from "./helpers";

describe("shouldShowCharts", () => {
  it("shows charts only for MORE than 6 months of data", () => {
    expect(shouldShowCharts(0)).toBe(false);
    expect(shouldShowCharts(5)).toBe(false);
    expect(shouldShowCharts(6)).toBe(false);
    expect(shouldShowCharts(7)).toBe(true);
    expect(shouldShowCharts(24)).toBe(true);
  });
});

describe("monthsWithData", () => {
  beforeEach(resetStore);

  it("counts only months that hold records, not the empty current month", async () => {
    const d = await getStore().read();
    expect(monthsWithData(d)).toEqual(SEED_MONTHS);
    expect(shouldShowCharts(monthsWithData(d).length)).toBe(false);
  });

  it("switches charts on when a 7th month of data arrives", async () => {
    const d = await getStore().read();
    const more: LedgerData = {
      ...d,
      pappyJoe: [
        ...d.pappyJoe,
        ...["2026-05", "2026-06", "2026-07", "2026-08"].map((month) => ({ month, clinic: "SDC1" as const, cash: 1000, upi: 0, card: 0 })),
      ],
    };
    expect(monthsWithData(more)).toHaveLength(7);
    expect(shouldShowCharts(monthsWithData(more).length)).toBe(true);
  });
});

describe("trendRows", () => {
  beforeEach(resetStore);

  it("gives one row per month with income, expenses and profit that add up", async () => {
    const d = await getStore().read();
    const rows = trendRows(d);
    expect(rows.map((r) => r.month)).toEqual(SEED_MONTHS);
    for (const r of rows) {
      expect(r.profit.ALL).toBeCloseTo(r.income - r.expenses);
      expect(r.profit.SDC1 + r.profit.SDC2).toBeCloseTo(r.profit.ALL);
    }
    // The gap figures are the same ones the Reconcile page shows for that month.
    for (const r of rows) {
      const rec = reconcileMonth(d, r.month);
      expect(r.cashNotDeposited).toBe(rec.cash.unexplained);
      expect(r.upiGap).toBe(rec.upi.pjTotal - rec.upi.bank);
    }
  });
});

describe("previewTrendRows", () => {
  it("gives 12 months of sample numbers ending at the given month, the same every time", () => {
    const a = previewTrendRows("2026-11");
    expect(a).toHaveLength(CHART_WINDOW_MONTHS);
    expect(a[0].month).toBe("2025-12");
    expect(a[11].month).toBe("2026-11");
    expect(previewTrendRows("2026-11")).toEqual(a);
    expect(shouldShowCharts(a.length)).toBe(true);
  });
});

describe("chart helpers", () => {
  it("counts months back across a year end", () => {
    expect(monthsEndingAt("2026-02", 4)).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });

  it("writes axis amounts in lakh and thousand", () => {
    expect(compactInr(0)).toBe("₹0");
    expect(compactInr(850)).toBe("₹850");
    expect(compactInr(85000)).toBe("₹85k");
    expect(compactInr(450000)).toBe("₹4.5L");
    expect(compactInr(1200000)).toBe("₹12L");
    expect(compactInr(-12000)).toBe("-₹12k");
    expect(compactInr(25000000)).toBe("₹2.5Cr");
  });

  it("makes round axis steps that include zero and cover the data", () => {
    const t = niceTicks(0, 812000);
    expect(t[0]).toBe(0);
    expect(t[t.length - 1]).toBeGreaterThanOrEqual(812000);
    expect(t.length).toBeLessThanOrEqual(6);
    const neg = niceTicks(-1500, 3400);
    expect(neg).toContain(0);
    expect(neg[0]).toBeLessThanOrEqual(-1500);
    expect(niceTicks(0, 0)).toEqual([0]);
  });

  it("puts the year under the first month and every January", () => {
    expect(axisMonth("2026-03", true)).toEqual({ month: "Mar", year: "2026" });
    expect(axisMonth("2026-04", false)).toEqual({ month: "Apr" });
    expect(axisMonth("2027-01", false)).toEqual({ month: "Jan", year: "2027" });
  });
});
