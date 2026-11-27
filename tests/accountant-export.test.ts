import { beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import { resetStore } from "./helpers";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));

const { getStore } = await import("@/lib/data/store");
const ex = await import("@/lib/accountant-export");
const { pnl } = await import("@/lib/calc");
const { sheetToXlsx } = await import("@/lib/xlsx-sheet");
const { exportOptions } = await import("@/lib/export-params");
import type { BankTxn } from "@/lib/types";

beforeEach(resetStore);

const bankRow = (p: Partial<BankTxn> & { date: string }): Omit<BankTxn, "id"> => ({
  narration: "TEST",
  refNo: "",
  valueDate: p.date,
  withdrawal: 0,
  deposit: 0,
  balance: 0,
  kind: "EXPENSE",
  fingerprint: `${p.date}-${p.narration}-${p.withdrawal}-${p.deposit}`,
  ...p,
});

describe("accountant export", () => {
  const oct = { from: "2026-10", to: "2026-10", scope: "ALL" as const };

  it("summary agrees with the dashboard P&L, for each clinic and combined", async () => {
    const d = await getStore().read();
    for (const scope of ["ALL", "SDC1", "SDC2"] as const) {
      const [row] = ex.summaryRows(d, { ...oct, scope });
      const p = pnl(d, "2026-10", scope);
      expect(row.income).toBeCloseTo(p.income, 2);
      expect(row.expenses).toBeCloseTo(p.expenses, 2);
      expect(row.cash + row.upi + row.card).toBeCloseTo(p.income, 2);
    }
  });

  it("categories add up to the month's expenses, and shared items are split for one clinic", async () => {
    const d = await getStore().read();
    for (const scope of ["ALL", "SDC1"] as const) {
      const t = ex.categoryTable(d, { ...oct, scope });
      expect(t.rows.reduce((s, r) => s + r.total, 0)).toBeCloseTo(pnl(d, "2026-10", scope).expenses, 2);
    }
    const sdc1 = ex.categoryTable(d, { ...oct, scope: "SDC1" });
    expect(sdc1.rows.find((r) => r.category === "Dental materials")?.total).toBe(8250); // half of 16,500
  });

  it("marks expenses matched to the bank, not found, or not bank payments, and adds bank-only payments", async () => {
    const store = getStore();
    await store.importBank(
      [
        bankRow({ date: "2026-10-01", narration: "PODANUR-RENT", withdrawal: 45000, category: "Rent", clinic: "SDC1" }),
        bankRow({ date: "2026-10-20", narration: "BIOWASTE CO", withdrawal: 900, category: "Biowaste", clinic: "SHARED" }),
      ],
      { fileName: "t.xls", importedBy: "admin" },
    );
    const d = await store.read();
    const lines = ex.expenseLines(d, oct);
    const rent = lines.find((l) => l.category === "Rent" && l.clinic === "SDC1")!;
    expect(rent).toMatchObject({ bankStatus: "Matched to bank", bankDate: "2026-10-01", bankNarration: "PODANUR-RENT" });
    expect(lines.find((l) => l.category === "Rent" && l.clinic === "SDC2")!.bankStatus).toBe("Not found in bank");
    expect(lines.find((l) => l.paidBy.startsWith("Petty cash"))!.bankStatus).toBe("Not a bank payment");
    const bio = lines.find((l) => l.category === "Biowaste")!;
    expect(bio).toMatchObject({ source: "Bank only (not entered in app)", amount: 900 });
    // For one clinic, a shared bank-only payment counts half.
    expect(ex.expenseLines(d, { ...oct, scope: "SDC2" }).find((l) => l.category === "Biowaste")!.share).toBe(450);
    // Every line's share adds up to the P&L expenses.
    expect(lines.reduce((s, l) => s + l.share, 0)).toBeCloseTo(pnl(d, "2026-10", "ALL").expenses, 2);
  });

  it("lists reconciliation gaps with answers when gap answers exist, and typed notes otherwise", async () => {
    const store = getStore();
    await store.importBank(
      [
        bankRow({ date: "2026-10-03", narration: "UPI-STRANGER", deposit: 1234, kind: "UPI_IN" }),
        bankRow({ date: "2026-10-05", narration: "MYSTERY SHOP", withdrawal: 777, kind: "UNKNOWN_OUT" }),
      ],
      { fileName: "t.xls", importedBy: "admin" },
    );
    await store.setReconNote("2026-10", "UPI", "Ask the front desk");
    const d = await store.read();
    const id = d.bankTxns.find((t) => t.narration === "UPI-STRANGER")!.id;
    const plain = ex.gapRows(d, oct);
    expect(plain.find((g) => g.details === "UPI-STRANGER")).toMatchObject({ type: "Bank UPI not in PappyJoe", amount: 1234, answer: "Ask the front desk" });
    expect(plain.find((g) => g.details === "MYSTERY SHOP")).toMatchObject({ followUp: "Pick a category on Import" });
    const answered = ex.gapRows(d, oct, [{ gapType: "UPI_BANK_ONLY", itemKey: id, amount: 1234, label: "Not patient income", followUp: true, todo: "Check", note: "refund" }]);
    expect(answered.find((g) => g.details === "UPI-STRANGER")).toMatchObject({ answer: "Not patient income · refund", followUp: "Check" });
  });

  it("shows month-end petty cash counts when they exist", async () => {
    const d = await getStore().read();
    const rows = ex.pettyRows(d, { ...oct, scope: "SDC1" }, [{ clinic: "SDC1", month: "2026-10", counted: 100, note: "box", reason: "Counting mistake" }]);
    expect(rows).toHaveLength(1);
    expect(rows[0].counted).toBe(100);
    expect(rows[0].difference).toBeCloseTo(100 - rows[0].expected, 2);
    expect(ex.pettyRows(d, oct)[0].counted).toBeNull();
  });

  it("builds all seven sheets and a readable Excel file with real dates and numbers", async () => {
    const d = await getStore().read();
    const sheets = ex.accountantSheets(d, { from: "2026-09", to: "2026-11", scope: "ALL" }, { madeBy: "Doctor", madeAt: new Date("2026-11-28T00:00:00Z") });
    expect(sheets.map((s) => s.name)).toEqual(["Summary", "Expenses by category", "Expenses", "Income by mode", "Petty cash", "Reconciliation gaps", "Bank statement"]);
    expect(sheets[0].rows[1][0]).toMatch(/^Both clinics combined · Sept? 2026 to Nov 2026$/);
    expect(sheets[0].rows.at(-5)?.[0]).toBe("Total");
    const wb = XLSX.utils.book_new();
    for (const s of sheets) XLSX.utils.book_append_sheet(wb, sheetToXlsx(s), s.name);
    const back = XLSX.read(XLSX.write(wb, { type: "buffer", bookType: "xlsx", cellDates: true }), { cellDates: true });
    const exp = XLSX.utils.sheet_to_json<unknown[]>(back.Sheets.Expenses, { header: 1 });
    expect(exp[5][0]).toBeInstanceOf(Date);
    expect(typeof exp[5][6]).toBe("number");
  });

  it("checks the range and picks the latest month by default", async () => {
    const d = await getStore().read();
    expect(ex.validateRange("2026-11", "2026-10")).toEqual({ ok: false, error: "The start month is after the end month." });
    expect(ex.validateRange("2024-01", "2026-10").ok).toBe(false);
    expect(ex.validateRange("2026-x", "2026-10").ok).toBe(false);
    expect(exportOptions(d, {}).options.from).toBe(exportOptions(d, {}).options.to);
    expect(exportOptions(d, { from: "2026-09", to: "2026-10", clinic: "SDC2" }).options).toEqual({ from: "2026-09", to: "2026-10", scope: "SDC2" });
    expect(ex.financialYear("2026-03")).toEqual({ from: "2025-04", to: "2026-03" });
    expect(ex.financialYear("2026-10")).toEqual({ from: "2026-04", to: "2027-03" });
    expect(ex.exportFileName({ from: "2026-10", to: "2026-10", scope: "SDC1" })).toBe("sdc-books-sdc1-2026-10.xlsx");
  });
});
