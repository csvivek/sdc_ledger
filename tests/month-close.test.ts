import { beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import { ADMIN, form, resetStore } from "./helpers";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAdmin: vi.fn(async () => ADMIN), requireUser: vi.fn(async () => ADMIN), SESSION_COOKIE: "t" }));
// "Today" is 28 Nov 2026 in India for these tests.
vi.mock("@/lib/calc", async (orig) => ({ ...(await orig<typeof import("@/lib/calc")>()), todayInIndia: () => "2026-11-28" }));

const { getStore } = await import("@/lib/data/store");
const { getExtras, SupabaseExtrasStore } = await import("@/lib/data/extras");
const mc = await import("@/lib/month-close");
const { closeMonthAction, reopenMonthAction } = await import("@/app/month-close/actions");
const { addExpense } = await import("@/app/actions");
const { importFiles, categoriseDebit } = await import("@/app/import/actions");
const { fakeClient, fakeDb } = await import("./fake-supabase");
import type { BankTxn } from "@/lib/types";

beforeEach(resetStore);

const bank = (date: string, narration: string, p: Partial<BankTxn> = {}): Omit<BankTxn, "id"> => ({
  date, narration, refNo: "", valueDate: date, withdrawal: 0, deposit: 0, balance: 0, kind: "UNKNOWN_OUT", fingerprint: `${date}-${narration}`, ...p,
});

/** A small HDFC statement file, laid out like the net banking download. */
function hdfcFile(txns: { date: string; narration: string; out?: number; in?: number }[]) {
  let bal = 100000;
  const body = txns.map((t, i) => {
    bal = bal - (t.out ?? 0) + (t.in ?? 0);
    return [t.date, t.narration, `R${i}`, t.date, t.out ?? "", t.in ?? "", bal];
  });
  const debits = txns.reduce((a, t) => a + (t.out ?? 0), 0);
  const credits = txns.reduce((a, t) => a + (t.in ?? 0), 0);
  const rows = [
    ["HDFC BANK Ltd.          Page No .:   1          Statement of accounts"],
    [""],
    ["Date", "Narration", "Chq./Ref.No.", "Value Dt", "Withdrawal Amt.", "Deposit Amt.", "Closing Balance"],
    ["**********", "**********", "**********", "**********", "**********", "**********", "**********"],
    ...body,
    ["**********"],
    ["STATEMENT SUMMARY  :-"],
    ["Opening Balance", "", "", "", "Debits", "Credits", "Closing Bal"],
    [100000, "", "", "", debits, credits, bal],
    ["", "", "", "", "Dr Count", "Cr Count", ""],
    ["", "", "", "", txns.filter((t) => t.out).length, txns.filter((t) => t.in).length, ""],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Sheet 1");
  return new File([new Uint8Array(XLSX.write(wb, { bookType: "biff8", type: "buffer" }))], "statement.xls");
}

const expenseForm = (date: string) => form({ amount: "450", category: "Flowers", clinic: "SDC1", paidBy: "PETTY_CASH", date, note: "", inPappyJoe: "NA" });

describe("month close checklist", () => {
  it("lists what is missing for a month with only typed PappyJoe totals and no bank statement", async () => {
    const d = await getStore().read();
    const items = mc.closeChecklist(d, "2026-10");
    const by = Object.fromEntries(items.map((i) => [i.key, i.status]));
    expect(by).toMatchObject({ bank: "todo", "pj-SDC1": "done", "pj-SDC2": "done", categorised: "done", gaps: "na", petty: "na" });
    expect(items.find((i) => i.key === "gaps")!.detail).toMatch(/not switched on yet/);
    expect(mc.blockers(items).map((i) => i.key)).toEqual(["bank"]);
  });

  it("sees a statement that stops early, then one that covers the month", async () => {
    const store = getStore();
    await store.importBank([bank("2026-10-02", "A", { kind: "UPI_IN", deposit: 5 }), bank("2026-10-20", "B", { kind: "UPI_IN", deposit: 5 })], { fileName: "x", importedBy: "admin" });
    let item = mc.closeChecklist(await store.read(), "2026-10").find((i) => i.key === "bank")!;
    expect(item).toMatchObject({ status: "todo" });
    expect(item.detail).toMatch(/stops on 2026-10-20/);
    await store.importBank([bank("2026-10-29", "C", { kind: "UPI_IN", deposit: 5 })], { fileName: "x", importedBy: "admin" });
    item = mc.closeChecklist(await store.read(), "2026-10").find((i) => i.key === "bank")!;
    expect(item.status).toBe("done");
  });

  it("asks for gap reasons and petty counts once those features exist", async () => {
    const store = getStore();
    await store.importBank([bank("2026-10-30", "UPI-STRANGER", { kind: "UPI_IN", deposit: 999 })], { fileName: "x", importedBy: "admin" });
    const d = await store.read();
    const id = d.bankTxns[0].id;
    const items = mc.closeChecklist(d, "2026-10", { gapAnswers: [], pettyCounts: [{ clinic: "SDC1", month: "2026-10", counted: 10, note: "" }] });
    const gaps = items.find((i) => i.key === "gaps")!;
    expect(gaps.status).toBe("todo");
    const open = Number(gaps.detail.match(/^(\d+) of/)![1]);
    expect(items.find((i) => i.key === "petty")!.detail).toMatch(/Not counted yet: SDC 2/);
    // Answer the new gap on the Reconcile page's store (PR #15).
    const reason = d.gapReasons.find((g) => g.gapType === "UPI_BANK_ONLY")!;
    await store.setGapAnswer({ gapType: "UPI_BANK_ONLY", itemKey: id, reasonId: reason.id, note: "", amount: 999 });
    const done = mc.closeChecklist(await store.read(), "2026-10", {
      gapAnswers: [],
      pettyCounts: ["SDC1", "SDC2"].map((c) => ({ clinic: c as "SDC1", month: "2026-10", counted: 1, note: "" })),
    });
    // One fewer gap without a reason (the seed's bank-paid expenses are still unanswered).
    expect(done.find((i) => i.key === "gaps")!.detail).toMatch(new RegExp(`^${open - 1} of`));
    expect(done.find((i) => i.key === "petty")!.status).toBe("done");
  });

  it("warns about card income still with the doctor, without blocking", async () => {
    const d = await getStore().read(); // seed has a pending card payment on 2026-10-23
    const card = mc.closeChecklist(d, "2026-10").find((i) => i.key === "cards")!;
    expect(card.status).toBe("warn");
    expect(mc.blockers([card])).toEqual([]);
  });

  it("only closes finished months, and needs a reason to close with items not done", () => {
    const todo = [{ key: "bank", label: "", status: "todo" as const, detail: "" }];
    expect(mc.checkClose([], "2026-11", "2026-11", false, "")).toMatchObject({ ok: false, error: expect.stringMatching(/not over yet/) });
    expect(mc.checkClose(todo, "2026-10", "2026-11", false, "")).toMatchObject({ ok: false, error: expect.stringMatching(/1 item\(s\) are not done/) });
    expect(mc.checkClose(todo, "2026-10", "2026-11", true, "no")).toMatchObject({ ok: false, error: expect.stringMatching(/Say why/) });
    expect(mc.checkClose(todo, "2026-10", "2026-11", true, "Bank sends the rest later")).toEqual({ ok: true, forced: true });
    expect(mc.checkClose([], "2026-10", "2026-11", false, "")).toEqual({ ok: true, forced: false });
    expect(mc.closableMonths(["2026-09", "2026-11", "2026-12"], "2026-11")).toEqual(["2026-09", "2026-10"]);
  });
});

describe("closing and reopening", () => {
  it("closes with a reason, blocks entries for that month only, and reopens with a reason", async () => {
    const r1 = await closeMonthAction({}, form({ month: "2026-10" }));
    // Bank statement missing, the seed's gaps have no reason yet, and petty cash is not counted (PR #15, #16).
    expect(r1.error).toMatch(/3 item\(s\) are not done/);
    const r2 = await closeMonthAction({}, form({ month: "2026-10", force: "1", note: "Statement comes later" }));
    expect(r2.ok).toMatch(/is closed/);
    expect(await getExtras().closedMonths()).toEqual(new Set(["2026-10"]));
    expect((await closeMonthAction({}, form({ month: "2026-10", force: "1", note: "again please" }))).error).toMatch(/already closed/);

    const blocked = await addExpense({}, expenseForm("2026-10-15"));
    expect(blocked.error).toMatch(/is closed, so nothing dated in it can be added/);
    expect((await addExpense({}, expenseForm("2026-11-15"))).ok).toMatch(/Saved/);

    expect((await reopenMonthAction({}, form({ month: "2026-10", reason: "oops" }))).error).toMatch(/Say why/);
    expect((await reopenMonthAction({}, form({ month: "2026-10", reason: "Lab bill was missed" }))).ok).toMatch(/open again/);
    expect((await addExpense({}, expenseForm("2026-10-15"))).ok).toMatch(/Saved/);

    const events = await getExtras().closeEvents("2026-10");
    expect(events.ready && events.value.map((e) => `${e.action}: ${e.reason}`)).toEqual(["reopen: Lab bill was missed", "close: Statement comes later"]);
    const closes = await getExtras().listCloses();
    expect(closes.ready && closes.value[0]).toMatchObject({ month: "2026-10", closed: false, reopenReason: "Lab bill was missed" });
    expect(closes.ready && closes.value[0].checklist.length).toBeGreaterThan(3);
  });

  it("refuses the current month", async () => {
    expect((await closeMonthAction({}, form({ month: "2026-11", force: "1", note: "trying early" }))).error).toMatch(/not over yet/);
  });

  it("an import skips rows in a closed month and says how many new ones were left out", async () => {
    await closeMonthAction({}, form({ month: "2026-10", force: "1", note: "closing for test" }));
    const fd = new FormData();
    fd.append("bank", hdfcFile([
      { date: "30/10/26", narration: "UPI-LATE OCT PATIENT-REF1", in: 700 },
      { date: "02/11/26", narration: "UPI-NOV PATIENT-REF2", in: 800 },
    ]));
    const res = await importFiles({}, fd);
    const lines = res.results![0].lines.join(" | ");
    expect(lines).toMatch(/1 new rows?, 0 already imported/);
    expect(lines).toMatch(/1 new row\(s\) dated in closed month\(s\) Oct 2026 were NOT imported/);
    const txns = (await getStore().read()).bankTxns;
    expect(txns.map((t) => t.date)).toEqual(["2026-11-02"]);
  });

  it("will not let a bank payment in a closed month be re-categorised", async () => {
    await getStore().importBank([bank("2026-10-05", "MYSTERY", { withdrawal: 50 })], { fileName: "x", importedBy: "admin" });
    const id = (await getStore().read()).bankTxns[0].id;
    await closeMonthAction({}, form({ month: "2026-10", force: "1", note: "closing for test" }));
    const r = await categoriseDebit({}, form({ id, choice: "EXPENSE:Lab", clinic: "SHARED" }));
    expect(r.error).toMatch(/Oct 2026 is closed/);
  });
});

describe("Supabase month close before and after the SQL", () => {
  const store = (db: ReturnType<typeof fakeDb>) => new SupabaseExtrasStore(async () => fakeClient(db) as never);

  it("no closed months and 'not switched on' until the tables exist", async () => {
    const db = fakeDb({}, ["month_closes", "month_close_events"]);
    expect(await store(db).closedMonths()).toEqual(new Set());
    expect(await store(db).listCloses()).toEqual({ ready: false });
    await expect(store(db).closeMonth("2026-10", [], "", "u1")).rejects.toThrow(/not switched on/);
  });

  it("reads closed months and turns database refusals into clear errors", async () => {
    const db = fakeDb({ month_closes: [{ month: "2026-10", closed: true }, { month: "2026-09", closed: false }], profiles: [] });
    expect(await store(db).closedMonths()).toEqual(new Set(["2026-10"]));
    db.rpcResult = () => ({ data: null, error: { code: "P0001", message: "ALREADY_CLOSED" } });
    await expect(store(db).closeMonth("2026-10", [], "", "u1")).rejects.toMatchObject({ code: "ALREADY_CLOSED" });
    expect(mc.closedMonthFromError(new Error("MONTH_CLOSED:2026-10"))).toBe("2026-10");
  });
});
