import { beforeEach, describe, expect, it } from "vitest";
import { monthsWithData } from "@/lib/calc";
import { getStore } from "@/lib/data/store";
import { SEED_MONTHS } from "@/lib/data/seed";
import { reconcileMonth } from "@/lib/recon";
import {
  axisMonth,
  addMonths,
  CHART_WINDOW_MONTHS,
  PREVIEW_MONTHS,
  sameMonthLastYear,
  windowStart,
  yoyChangePct,
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
  it("gives 30 months of sample numbers ending at the given month, the same every time", () => {
    const a = previewTrendRows("2026-11");
    expect(a).toHaveLength(PREVIEW_MONTHS);
    expect(PREVIEW_MONTHS).toBeGreaterThan(24); // more than two years, so last-year comparison can be tried
    expect(a[0].month).toBe("2024-06");
    expect(a[a.length - 1].month).toBe("2026-11");
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

describe("chart window: latest 12 months by default, all when asked", () => {
  it("starts at the 12th month from the end unless All is on", () => {
    expect(CHART_WINDOW_MONTHS).toBe(12);
    expect(windowStart(30, false)).toBe(18);
    expect(windowStart(30, true)).toBe(0);
    expect(windowStart(7, false)).toBe(0);
    expect(windowStart(12, false)).toBe(0);
  });
});

describe("year-on-year", () => {
  it("steps months across year ends", () => {
    expect(addMonths("2026-01", -12)).toBe("2025-01");
    expect(addMonths("2026-03", -4)).toBe("2025-11");
    expect(addMonths("2025-12", 1)).toBe("2026-01");
  });

  it("finds the same month last year in the full history, even before the 12 months shown", () => {
    const sample = previewTrendRows("2026-11");
    const months = sample.map((r) => r.month);
    const income = sample.map((r) => r.income);
    const shown = months.slice(windowStart(months.length, false));
    const ly = sameMonthLastYear(months, income, shown);
    expect(shown[0]).toBe("2025-12");
    expect(ly[0]).toBe(income[months.indexOf("2024-12")]);
    expect(ly.every((v) => v !== null)).toBe(true);
  });

  it("gives null for months with no data last year, including gaps", () => {
    const months = ["2026-01", "2026-10", "2027-01", "2027-02"];
    const ly = sameMonthLastYear(months, [100, 200, 150, 90], ["2027-01", "2027-02"]);
    expect(ly).toEqual([100, null]);
    expect(sameMonthLastYear(["2026-10", "2026-11"], [1, 2], ["2026-10", "2026-11"])).toEqual([null, null]);
  });

  it("works out the change in percent, or none when last year is missing or zero", () => {
    expect(yoyChangePct(110, 100)).toBe(10);
    expect(yoyChangePct(80, 100)).toBe(-20);
    expect(yoyChangePct(-50, -100)).toBe(50);
    expect(yoyChangePct(100, null)).toBeNull();
    expect(yoyChangePct(100, 0)).toBeNull();
  });
});
