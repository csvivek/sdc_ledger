import { beforeEach, describe, expect, it } from "vitest";
import { getStore } from "@/lib/data/store";
import { bankBeneficiary, normName, NOT_ASSIGNED, parsePeriod, parseScope, payeeRanking, periodMonths } from "@/lib/payee-report";
import type { BankTxn, Expense, LedgerData } from "@/lib/types";
import { resetStore } from "./helpers";

let n = 0;
function exp(date: string, amount: number, category: string, clinic: Expense["clinic"], payeeId?: string): Expense {
  n += 1;
  return { id: `e${n}`, date, amount, category, clinic, paidBy: "BANK", note: "", payeeId, enteredBy: "admin", enteredAt: `${date}T10:00:00Z` };
}
function debit(date: string, amount: number, category: string, narration: string, clinic?: BankTxn["clinic"]): BankTxn {
  n += 1;
  return {
    id: `b${n}`,
    date,
    narration,
    refNo: `R${n}`,
    valueDate: date,
    withdrawal: amount,
    deposit: 0,
    balance: 0,
    kind: "EXPENSE",
    category,
    clinic,
    fingerprint: `f${n}`,
  };
}

async function data(): Promise<LedgerData> {
  const d = await getStore().read();
  return {
    ...d,
    payees: [
      ...d.payees,
      { id: "c_priya", kind: "consultant", name: "Dr Priyanka G", active: true },
      { id: "c_ash", kind: "consultant", name: "Ashwini N", active: true },
      { id: "l_zahn", kind: "lab", name: "Zahn Artz Dental Lab", active: true },
    ],
    expenses: [
      exp("2026-10-05", 5000, "Consultant", "SDC1", "c_ash"),
      exp("2026-10-06", 2000, "Consultant", "SHARED", "c_priya"),
      exp("2026-10-07", 1500, "Consultant", "SDC2"), // no payee chosen
      exp("2025-01-10", 9999, "Consultant", "SDC1", "c_priya"), // older than 12 months
      exp("2026-10-08", 700, "Salary", "SDC1"), // not a consultant/lab/pharma category
    ],
    bankTxns: [
      debit("2026-10-12", 21500, "Consultant", "NEFT DR-CIUB0000053-ASHWINI N-NETBANK, MUM-HDFCH00769723139-SDC1 JAN ORTHO CON", "SDC1"),
      debit("2026-10-13", 12000, "Consultant", "NEFT DR-SBIN0012769-DR PRIYANKA G-NETBANK, MUM-HDFCH00739584535-CD PATIENT SECRETNAME", "SDC2"),
      debit("2026-10-14", 3500, "Consultant", "NEFT DR-IDIB000C071-DR ARSHADH-NETBANK, MUM-HDFCH00769712771-CONS SURG", "SDC1"),
      debit("2026-10-15", 945, "Lab", "NEFT DR-ICIC0007962-ZAHN ARTZ DENTAL LAB-NETBANK, MUM-HDFCH01338562298-LAB", "SDC2"),
      debit("2026-10-16", 300, "Lab", "CHQ PAID-000123", "SDC2"),
    ],
  };
}

describe("reading the bank narration", () => {
  it("takes only the beneficiary name, never the remarks", () => {
    expect(bankBeneficiary("NEFT DR-SBIN0012769-DR PRIYANKA G-NETBANK, MUM-HDFCH00739584535-CD PATIENT SECRETNAME")).toBe("DR PRIYANKA G");
    expect(bankBeneficiary("UPI-ADHINANDIN AGENCIES-adhi@okaxis-UTIB0000001-123-PHARMA")).toBe("ADHINANDIN AGENCIES");
    expect(bankBeneficiary("CHQ PAID-000123")).toBeNull();
  });

  it("matches names regardless of Dr, dots, spaces and case", () => {
    expect(normName("Dr. Priyanka G")).toBe(normName("DR PRIYANKA G"));
    expect(normName("Zahn Artz Dental Lab")).toBe("ZAHNARTZDENTALLAB");
  });
});

describe("payeeRanking", () => {
  beforeEach(resetStore);

  it("ranks consultants by money paid, joining portal and bank payments to the same payee", async () => {
    const r = payeeRanking(await data(), "consultant", "12m", "2026-10", "ALL");
    expect(r.rows.map((x) => [x.name, x.source, x.amount, x.payments])).toEqual([
      ["Ashwini N", "payee", 26500, 2],
      ["Dr Priyanka G", "payee", 14000, 2],
      ["Dr Arshadh", "bank", 3500, 1],
      [NOT_ASSIGNED, "none", 1500, 1],
    ]);
    expect(r.total).toBe(45500);
    expect(r.payments).toBe(6);
    expect(r.rows.reduce((s, x) => s + x.share, 0)).toBeCloseTo(100);
    expect(r.rows[0].lastPaid).toBe("2026-10-12");
  });

  it("always puts Not assigned last, so the total still matches the category", async () => {
    const r = payeeRanking(await data(), "lab", "12m", "2026-10", "ALL");
    expect(r.rows.map((x) => x.name)).toEqual(["Zahn Artz Dental Lab", NOT_ASSIGNED]);
    expect(r.total).toBe(1245);
  });

  it("filters by clinic and splits shared payments 50/50", async () => {
    const r = payeeRanking(await data(), "consultant", "12m", "2026-10", "SDC2");
    expect(r.rows.map((x) => [x.name, x.amount])).toEqual([
      ["Dr Priyanka G", 13000], // 12000 from bank + half of the 2000 shared entry
      [NOT_ASSIGNED, 1500],
    ]);
  });

  it("limits to the chosen period", async () => {
    const d = await data();
    expect(payeeRanking(d, "consultant", "all", "2026-10", "ALL").total).toBe(45500 + 9999);
    expect(payeeRanking(d, "consultant", "month", "2026-09", "ALL").rows).toEqual([]);
    expect(periodMonths("12m", "2026-10")).toEqual({ from: "2025-11", to: "2026-10" });
    expect(periodMonths("month", "2026-10")).toEqual({ from: "2026-10", to: "2026-10" });
    expect(periodMonths("all", "2026-10")).toBeNull();
  });

  it("never shows bank remarks such as patient names", async () => {
    const r = payeeRanking(await data(), "consultant", "all", "2026-10", "ALL");
    expect(JSON.stringify(r)).not.toMatch(/SECRETNAME|PATIENT/);
  });

  it("defaults to the last 12 months and both clinics", () => {
    expect(parsePeriod(undefined)).toBe("12m");
    expect(parsePeriod("month")).toBe("month");
    expect(parsePeriod("junk")).toBe("12m");
    expect(parseScope(undefined)).toBe("ALL");
    expect(parseScope("SDC2")).toBe("SDC2");
  });
});
