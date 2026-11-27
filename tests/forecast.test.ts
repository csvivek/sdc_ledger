import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetStore } from "./helpers";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));

const { getStore } = await import("@/lib/data/store");
const f = await import("@/lib/forecast");
const { pnl } = await import("@/lib/calc");

beforeEach(resetStore);

describe("estimateSeries", () => {
  it("is empty with no history", () => {
    expect(f.estimateSeries([])).toEqual([]);
  });

  it("with one month, repeats it with a ±15% range", () => {
    const [e] = f.estimateSeries([100000], 1);
    expect(e).toEqual({ value: 100000, low: 85000, high: 115000 });
  });

  it("weights recent months more and shows the lowest and highest month as the range", () => {
    const [e] = f.estimateSeries([100000, 200000], 1);
    // (1×100k + 2×200k) / 3
    expect(e.value).toBe(166700);
    expect(e.low).toBe(100000);
    expect(e.high).toBe(200000);
  });

  it("follows a steady rise once there are 6 months", () => {
    const rising = [100, 110, 120, 130, 140, 150].map((x) => x * 1000);
    const [next, after] = f.estimateSeries(rising, 2);
    expect(next.value).toBe(160000);
    expect(after.value).toBe(170000);
    // A flat history stays flat.
    expect(f.estimateSeries(Array(6).fill(50000), 3).map((e) => e.value)).toEqual([50000, 50000, 50000]);
  });

  it("only looks at the last 6 months and never goes below zero", () => {
    expect(f.estimateSeries([9e9, 0, 0, 0, 0, 0, 0], 1)[0].value).toBe(0);
    expect(f.estimateSeries([60, 50, 40, 30, 20, 10].map((x) => x * 1000), 8).at(-1)!.value).toBe(0);
  });
});

describe("forecast from the ledger", () => {
  it("uses only finished months with PappyJoe income, and labels fewer than 6 as unreliable", async () => {
    const d = await getStore().read(); // seed: Sep, Oct, Nov 2026 typed PappyJoe totals
    const fc = f.forecast(d, "ALL", "2026-11");
    expect(fc.basedOn).toEqual(["2026-09", "2026-10"]);
    expect(fc.reliable).toBe(false);
    expect(f.forecastNote(fc)).toMatch(/not reliable yet: it is based on only 2 finished months/);
    expect(fc.months.map((m) => m.month)).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
    const sep = pnl(d, "2026-09", "ALL");
    const oct = pnl(d, "2026-10", "ALL");
    expect(fc.months[0].income.value).toBe(Math.round((sep.income + 2 * oct.income) / 3 / 100) * 100);
    expect(fc.months[0].profit.value).toBe(fc.months[0].income.value - fc.months[0].expenses.value);
    expect(fc.months[0].profit.low).toBeLessThanOrEqual(fc.months[0].profit.value);
  });

  it("works per clinic, and clinics add up to about the combined estimate", async () => {
    const d = await getStore().read();
    const a = f.forecast(d, "SDC1", "2026-11").months[0];
    const b = f.forecast(d, "SDC2", "2026-11").months[0];
    const all = f.forecast(d, "ALL", "2026-11").months[0];
    expect(Math.abs(a.income.value + b.income.value - all.income.value)).toBeLessThanOrEqual(200);
  });

  it("says so when there is nothing to go on", async () => {
    const d = await getStore().read();
    const fc = f.forecast(d, "ALL", "2026-09");
    expect(fc.basedOn).toEqual([]);
    expect(fc.months).toEqual([]);
    expect(f.forecastNote(fc)).toMatch(/Not enough data yet/);
  });

  it("is labelled reliable with 6 or more months", () => {
    const months = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"];
    const fc = f.fromHistory("ALL", months, months.map(() => 1000), months.map(() => 500), "2026-07");
    expect(fc.reliable).toBe(true);
    expect(f.forecastNote(fc)).toMatch(/last 6 finished months/);
  });
});
