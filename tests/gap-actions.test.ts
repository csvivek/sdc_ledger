import { beforeEach, describe, expect, it, vi } from "vitest";
import { ADMIN, form, resetStore } from "./helpers";
import type { BankTxn, PjReceipt } from "@/lib/types";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAdmin: vi.fn(async () => ADMIN), requireUser: vi.fn(async () => ADMIN) }));

const { getStore } = await import("@/lib/data/store");
const { saveGapAnswer, forgetGapRule } = await import("@/app/reconciliation/actions");
const { reconcileMonth } = await import("@/lib/recon");
const { collectGaps, gapStates } = await import("@/lib/gaps");

const MONTH = "2026-10";
let n = 0;
const txn = (date: string, narration: string, kind: BankTxn["kind"], deposit: number): Omit<BankTxn, "id"> => ({
  date,
  narration,
  refNo: "R" + ++n,
  valueDate: date,
  withdrawal: 0,
  deposit,
  balance: 0,
  kind,
  fingerprint: "fp" + n,
});
const receipt = (date: string, no: string, amount: number, mode: PjReceipt["mode"], patient = "Patient " + no): Omit<PjReceipt, "id" | "clinic"> => ({
  date,
  patientName: patient,
  patientId: "SDCC-" + patient,
  receiptNo: no,
  invoiceNo: "INV" + no,
  invoiceTotal: amount,
  amount,
  mode,
  paymentInfo: mode,
  receiptBy: "Front desk",
});

async function seed(extraBank: Omit<BankTxn, "id">[] = []) {
  const s = getStore();
  await s.importBank(
    [
      txn("2026-10-03", "UPI-1-SOMEONE-x@ok-REF1-PAY", "UPI_IN", 1000),
      txn("2026-10-05", "UPI-1-RAVI KUMAR-ravi@ok-REF2-PAY", "UPI_IN", 500),
      txn("2026-10-20", "UPI-1-RAVI KUMAR-ravi@ok-REF3-PAY", "UPI_IN", 700),
      txn("2026-10-25", "CASH DEPOSIT", "CASH_DEPOSIT", 3000),
      ...extraBank,
    ],
    { fileName: "bank.xls", importedBy: ADMIN.id },
  );
  await s.importPappyJoe("SDC1", [receipt("2026-10-03", "1", 1000, "UPI"), receipt("2026-10-04", "2", 5000, "CASH")], { fileName: "p1.xlsx", importedBy: ADMIN.id });
  await s.importPappyJoe("SDC2", [receipt("2026-10-10", "3", 800, "UPI")], { fileName: "p2.xlsx", importedBy: ADMIN.id });
}

async function states() {
  const d = await getStore().read();
  return { d, s: gapStates(d, collectGaps(d, reconcileMonth(d, MONTH))) };
}

const find = (s: Awaited<ReturnType<typeof states>>["s"], type: string, amount: number) => s.find((x) => x.item.type === type && x.item.amount === amount)!;

const answer = (type: string, key: string, o: Record<string, string> = {}) =>
  saveGapAnswer({}, form({ month: MONTH, gapType: type, itemKey: key, ...o }));

beforeEach(async () => {
  await resetStore();
  n = 0;
});

describe("gaps", () => {
  it("lists each gap with a suggested answer from the hint", async () => {
    await seed();
    const { d, s } = await states();
    // The fake seed data has portal expenses too; this test is about the imported files.
    expect(s.filter((x) => x.item.type !== "PORTAL_ONLY").map((x) => `${x.item.type} ${x.item.amount}`).sort()).toEqual(
      ["CASH_GAP 2000", "UPI_BANK_ONLY 500", "UPI_BANK_ONLY 700", "UPI_PJ_ONLY 800"].sort(),
    );
    expect(s.every((x) => x.status === "open")).toBe(true);
    const bank = find(s, "UPI_BANK_ONLY", 500);
    expect(d.gapReasons.find((r) => r.id === bank.suggestion?.reasonId)?.code).toBe("bank_not_entered");
    expect(bank.item.signatureLabel).toBe("UPI from RAVI KUMAR");
    expect(d.gapReasons.find((r) => r.id === find(s, "CASH_GAP", 2000).suggestion?.reasonId)?.code).toBe("cash_next_month");
  });

  it("saves a picked answer and shows the item as answered", async () => {
    await seed();
    const { d, s } = await states();
    const item = find(s, "UPI_PJ_ONLY", 800).item;
    const reason = d.gapReasons.find((r) => r.code === "pj_doctor_account")!;
    const res = await answer(item.type, item.key, { reasonId: reason.id, note: "Asked the doctor" });
    expect(res).toEqual({ saved: true, notice: undefined });
    const after = find((await states()).s, "UPI_PJ_ONLY", 800);
    expect(after.status).toBe("answered");
    expect(after.reason?.followUp).toBe(true);
    expect(after.answer?.note).toBe("Asked the doctor");
  });

  it("suggests the earlier answer for the same sender", async () => {
    await seed();
    const { d, s } = await states();
    const first = find(s, "UPI_BANK_ONLY", 500).item;
    const reason = d.gapReasons.find((r) => r.code === "bank_not_patient")!;
    await answer(first.type, first.key, { reasonId: reason.id });
    const second = find((await states()).s, "UPI_BANK_ONLY", 700);
    expect(second.status).toBe("open");
    expect(second.suggestion).toEqual({ reasonId: reason.id, why: "what you chose last time for UPI from RAVI KUMAR" });
  });

  it("adds a typed answer once, and reuses it when the same words are typed again", async () => {
    await seed();
    const { d, s } = await states();
    const before = d.gapReasons.length;
    const a = find(s, "UPI_BANK_ONLY", 500).item;
    const b = find(s, "UPI_BANK_ONLY", 700).item;
    expect(await answer(a.type, a.key, { reasonId: "NEW", newLabel: "Advance for next visit", newFollowUp: "1" })).toMatchObject({ saved: true });
    const res = await answer(b.type, b.key, { reasonId: "NEW", newLabel: "  advance FOR next   visit. " });
    expect(res.saved).toBe(true);
    expect(res.notice).toMatch(/"Advance for next visit" is already an answer/);
    const after = await states();
    expect(after.d.gapReasons.length).toBe(before + 1);
    const added = after.d.gapReasons.at(-1)!;
    expect(added).toMatchObject({ gapType: "UPI_BANK_ONLY", label: "Advance for next visit", followUp: true });
    expect(find(after.s, "UPI_BANK_ONLY", 700).reason?.id).toBe(added.id);
  });

  it("refuses a typed answer that is too short, and an empty pick", async () => {
    await seed();
    const a = find((await states()).s, "UPI_BANK_ONLY", 500).item;
    expect((await answer(a.type, a.key, { reasonId: "NEW", newLabel: "x" })).error).toMatch(/3 to 120/);
    expect((await answer(a.type, a.key, {})).error).toMatch(/Pick what happened/);
    expect((await answer(a.type, "nope", { reasonId: "NEW", newLabel: "Something" })).error).toMatch(/no longer a gap/);
  });

  it("remembers an answer for the same sender and answers the others automatically", async () => {
    await seed();
    const { d, s } = await states();
    const a = find(s, "UPI_BANK_ONLY", 500).item;
    const reason = d.gapReasons.find((r) => r.code === "bank_not_patient")!;
    const res = await answer(a.type, a.key, { reasonId: reason.id, remember: "1" });
    expect(res.notice).toMatch(/1 more item\(s\) for UPI from RAVI KUMAR/);
    const after = await states();
    expect(after.d.gapRules).toHaveLength(1);
    expect(find(after.s, "UPI_BANK_ONLY", 700)).toMatchObject({ status: "auto", reason: { id: reason.id } });

    // A second rule for the same sender is declined softly; this item's own answer is still saved.
    const b = find(after.s, "UPI_BANK_ONLY", 700).item;
    const other = d.gapReasons.find((r) => r.code === "bank_date_far")!;
    const res2 = await answer(b.type, b.key, { reasonId: other.id, remember: "1" });
    expect(res2.saved).toBe(true);
    expect(res2.notice).toMatch(/already remembered as "Not patient income/);
    const final = await states();
    expect(final.d.gapRules).toHaveLength(1);
    expect(find(final.s, "UPI_BANK_ONLY", 700)).toMatchObject({ status: "answered", reason: { id: other.id } });

    // Forgetting the rule leaves explicit answers alone.
    await forgetGapRule(form({ id: final.d.gapRules[0].id }));
    expect((await getStore().read()).gapRules).toHaveLength(0);
    expect(find((await states()).s, "UPI_BANK_ONLY", 700).status).toBe("answered");
  });

  it("asks about portal expenses not found in the bank, remembering per category and payee", async () => {
    await seed();
    const { s } = await states();
    const portal = s.filter((x) => x.item.type === "PORTAL_ONLY");
    expect(portal.length).toBeGreaterThan(0);
    expect(portal.every((x) => x.item.signature && x.item.signatureLabel)).toBe(true);
  });

  it("asks again when a cash gap changes after it was answered", async () => {
    await seed();
    const { d, s } = await states();
    const cash = find(s, "CASH_GAP", 2000).item;
    await answer(cash.type, cash.key, { reasonId: d.gapReasons.find((r) => r.code === "cash_with_doctor")!.id });
    expect(find((await states()).s, "CASH_GAP", 2000).status).toBe("answered");
    await getStore().importBank([txn("2026-10-28", "CASH DEPOSIT 2", "CASH_DEPOSIT", 1500)], { fileName: "b2.xls", importedBy: ADMIN.id });
    const again = find((await states()).s, "CASH_GAP", 500);
    expect(again).toMatchObject({ status: "open", changedFrom: 2000 });
    expect(again.suggestion?.why).toBe("your earlier answer");
  });
});
