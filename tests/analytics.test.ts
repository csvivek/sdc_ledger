import { describe, expect, it } from "vitest";
import { analyticsRows, cardCost, cardCostShare, modeShare, parseQuote, previewAnalyticsRows, receiptMonths } from "@/lib/analytics";
import { pappyJoeMonths } from "@/lib/calc";
import { shouldShowCharts } from "@/lib/trend";
import type { ClinicId, LedgerData, PayMode, PjReceipt } from "@/lib/types";

let n = 0;
function rec(clinic: ClinicId, date: string, patientId: string, amount: number, mode: PayMode = "CASH"): PjReceipt {
  n += 1;
  return {
    id: `r${n}`,
    clinic,
    date,
    patientName: `SECRET NAME ${patientId}`,
    patientId,
    receiptNo: `RN${n}`,
    invoiceNo: `IN${n}`,
    invoiceTotal: Math.abs(amount),
    amount,
    mode,
    paymentInfo: "9876543210",
    receiptBy: "Staff",
  };
}

const receipts: PjReceipt[] = [
  // SDC1, Oct: patient A twice on one day (one visit), then again later (second visit); patient B by UPI; a correction.
  rec("SDC1", "2026-10-02", "SDCCP1", 500),
  rec("SDC1", "2026-10-02", "SDCCP1", 300, "UPI"),
  rec("SDC1", "2026-10-09", "SDCCP1", 1000),
  rec("SDC1", "2026-10-09", "SDCCP2", 2000, "UPI"),
  rec("SDC1", "2026-10-20", "SDCCP2", -200),
  // SDC2, Oct: one card payment.
  rec("SDC2", "2026-10-05", "SDCCM1", 4700, "CARD"),
  // Jan: one payment each.
  rec("SDC1", "2026-01-15", "SDCCP9", 800, "UPI"),
  rec("SDC2", "2026-01-15", "SDCCM9", 600),
];

const row = (month: string, scope: string) => analyticsRows(receipts).find((r) => r.month === month && r.scope === scope)!;

describe("analyticsRows", () => {
  it("gives a row per month for each clinic and both clinics, oldest first", () => {
    const rows = analyticsRows(receipts);
    expect(receiptMonths(receipts)).toEqual(["2026-01", "2026-10"]);
    expect(rows.map((r) => `${r.month} ${r.scope}`)).toEqual([
      "2026-01 SDC1",
      "2026-01 SDC2",
      "2026-01 ALL",
      "2026-10 SDC1",
      "2026-10 SDC2",
      "2026-10 ALL",
    ]);
  });

  it("counts distinct patients and paying visits (one patient on one day)", () => {
    const r = row("2026-10", "SDC1");
    expect(r.patients).toBe(2);
    expect(r.visits).toBe(3); // A on the 2nd, A on the 9th, B on the 9th; the correction is not a visit
    expect(r.openDays).toBe(2);
    expect(r.payments).toBe(4);
    expect(r.visitsPerDay).toBeCloseTo(1.5);
  });

  it("uses net revenue, corrections included, and divides it per patient and per visit", () => {
    const r = row("2026-10", "SDC1");
    expect(r.revenue).toBe(3600);
    expect(r.corrections).toBe(-200);
    expect(r.correctionLines).toBe(1);
    expect(r.perPatient).toBe(1800);
    expect(r.perVisit).toBe(1200);
  });

  it("agrees with the dashboard Income for every month and clinic", () => {
    const d = { pjReceipts: receipts, pappyJoe: [] } as unknown as LedgerData;
    for (const p of pappyJoeMonths(d)) {
      expect(row(p.month, p.clinic).revenue).toBe(p.cash + p.upi + p.card);
    }
  });

  it("adds both clinics together without merging their patient ids", () => {
    const a = row("2026-10", "ALL");
    expect(a.patients).toBe(3);
    expect(a.visits).toBe(4);
    expect(a.revenue).toBe(8300);
    expect(a.modes.CARD).toEqual({ count: 1, amount: 4700 });
  });

  it("splits money and payments by mode, counting only positive lines as payments", () => {
    const r = row("2026-10", "SDC1");
    expect(r.modes.CASH).toEqual({ count: 2, amount: 1300 });
    expect(r.modes.UPI).toEqual({ count: 2, amount: 2300 });
    expect(r.modes.CARD).toEqual({ count: 0, amount: 0 });
    expect(modeShare(r, "UPI", "count")).toBe(50);
    expect(modeShare(r, "UPI", "amount")).toBeCloseTo((2300 / 3600) * 100);
  });

  it("never carries patient names, ids or payment details into the results", () => {
    const text = JSON.stringify(analyticsRows(receipts));
    expect(text).not.toMatch(/SECRET NAME|SDCCP|SDCCM|9876543210/);
  });

  it("returns nothing when no PappyJoe payments are imported", () => {
    expect(analyticsRows([])).toEqual([]);
  });
});

describe("charts threshold", () => {
  it("keeps 2 months of PappyJoe payments as tables only", () => {
    expect(shouldShowCharts(receiptMonths(receipts).length)).toBe(false);
  });
});

describe("card machine quote", () => {
  it("shows no cost until both boxes hold a number", () => {
    expect(parseQuote("", "")).toBeNull();
    expect(parseQuote("1.5", "")).toBeNull();
    expect(parseQuote("", "500")).toBeNull();
    expect(parseQuote("abc", "500")).toBeNull();
    expect(parseQuote("-1", "500")).toBeNull();
    expect(parseQuote("1.5", "-5")).toBeNull();
    expect(parseQuote(" 1.5 ", "500")).toEqual({ ratePct: 1.5, monthlyRent: 500 });
    expect(parseQuote("0", "0")).toEqual({ ratePct: 0, monthlyRent: 0 });
  });

  it("works out monthly cost as charge on card money plus rent", () => {
    const q = { ratePct: 2, monthlyRent: 500 };
    expect(cardCost(4700, q)).toBe(594);
    expect(cardCost(0, q)).toBe(500);
    expect(cardCostShare(25000, q)).toBe(4);
    expect(cardCostShare(0, q)).toBeNull();
  });
});

describe("previewAnalyticsRows", () => {
  it("is deterministic sample data with three rows per month that add up", () => {
    const a = previewAnalyticsRows("2026-11");
    expect(a).toEqual(previewAnalyticsRows("2026-11"));
    expect(a).toHaveLength(36);
    expect(a[a.length - 1].month).toBe("2026-11");
    for (let i = 0; i < a.length; i += 3) {
      const [s1, s2, all] = a.slice(i, i + 3);
      expect(all.revenue).toBe(s1.revenue + s2.revenue);
      expect(all.patients).toBe(s1.patients + s2.patients);
      for (const r of [s1, s2, all]) {
        const modeSum = r.modes.CASH.amount + r.modes.UPI.amount + r.modes.CARD.amount + r.modes.OTHER.amount;
        expect(modeSum).toBe(r.revenue);
      }
    }
  });
});
