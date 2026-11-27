import { beforeEach, describe, expect, it } from "vitest";
import { monthsIn, pettyCash, pettyCashMonth } from "@/lib/calc";
import { getStore } from "@/lib/data/store";
import { reconcileMonth } from "@/lib/recon";
import { CLINICS, type BankTxn, type Expense, type LedgerData } from "@/lib/types";
import { resetStore } from "./helpers";

const expense = (id: string, date: string, amount: number, clinic: "SDC1" | "SDC2"): Expense => ({
  id,
  date,
  amount,
  category: "Flowers",
  clinic,
  paidBy: "PETTY_CASH",
  pettyCashClinic: clinic,
  note: "test",
  enteredBy: "t",
  enteredAt: `${date}T10:00:00Z`,
});

const bankPetty = (id: string, date: string, withdrawal: number) =>
  ({ id, date, withdrawal, deposit: 0, kind: "PETTY_CASH", narration: "TPT-PETTY CASH" }) as unknown as BankTxn;

/** A small ledger with nothing in it but petty cash movements. */
async function ledger(): Promise<LedgerData> {
  const d = await getStore().read();
  return {
    ...d,
    expenses: [
      expense("e1", "2026-09-10", 1000, "SDC1"),
      expense("e2", "2026-10-05", 4000, "SDC1"),
      expense("e3", "2026-10-20", 500, "SDC2"),
    ],
    pettyCashTransfers: [],
    pettyCashOpening: { SDC1: 200, SDC2: 0 },
    bankTxns: [bankPetty("b1", "2026-09-01", 7000), bankPetty("b2", "2026-10-01", 7000)],
  };
}

describe("pettyCashMonth", () => {
  beforeEach(resetStore);

  it("carries leftover cash into the next month instead of resetting", async () => {
    const d = await ledger();
    const sep = pettyCashMonth(d, "SDC1", "2026-09");
    expect(sep).toMatchObject({ carriedIn: 200, received: 3500, spent: 1000, leftAtEnd: 2700 });
    const oct = pettyCashMonth(d, "SDC1", "2026-10");
    expect(oct).toMatchObject({ carriedIn: 2700, received: 3500, spent: 4000, leftAtEnd: 2200 });
    const nov = pettyCashMonth(d, "SDC1", "2026-11");
    expect(nov).toMatchObject({ carriedIn: 2200, received: 0, spent: 0, leftAtEnd: 2200 });
  });

  it("lists only that month's movements", async () => {
    const d = await ledger();
    const oct = pettyCashMonth(d, "SDC1", "2026-10");
    expect(oct.transfersIn.map((t) => t.id)).toEqual(["b2"]);
    expect(oct.spentList.map((e) => e.id)).toEqual(["e2"]);
    const octSdc2 = pettyCashMonth(d, "SDC2", "2026-10");
    expect(octSdc2.spentList.map((e) => e.id)).toEqual(["e3"]);
  });

  it("ends the latest month on the same balance as all time", async () => {
    const d = await ledger();
    for (const c of CLINICS) {
      expect(pettyCashMonth(d, c, "2026-12").leftAtEnd).toBe(pettyCash(d, c).balance);
    }
  });

  it("matches the Reconcile page for every month of the sample data", async () => {
    const d = await getStore().read();
    for (const m of monthsIn(d)) {
      const r = reconcileMonth(d, m);
      for (const c of CLINICS) {
        const p = pettyCashMonth(d, c, m);
        expect(r.petty[c]).toEqual({
          opening: p.carriedIn,
          received: p.received,
          spent: p.spent,
          expected: p.expected,
          counted: p.count?.counted,
          difference: p.difference,
          closing: p.leftAtEnd,
        });
      }
    }
  });

  it("each month starts where the one before ended (sample data)", async () => {
    const d = await getStore().read();
    const months = monthsIn(d);
    for (const c of CLINICS) {
      for (let i = 1; i < months.length; i++) {
        expect(pettyCashMonth(d, c, months[i]).carriedIn).toBeCloseTo(pettyCashMonth(d, c, months[i - 1]).leftAtEnd, 6);
      }
    }
  });
});
