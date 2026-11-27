import { beforeEach, describe, expect, it, vi } from "vitest";
import { ADMIN, form, resetStore } from "./helpers";
import { asFile, bankDays, hdfcFile, otherSheet, pappyJoeFile, PJ_HEADER, HDFC_HEADER } from "./import-fixtures";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAdmin: vi.fn(async () => ADMIN), requireUser: vi.fn(async () => ADMIN) }));

const { getStore } = await import("@/lib/data/store");
const { importFiles, previewMonthDelete, deleteImportedMonth } = await import("@/app/import/actions");
const { checkUpload } = await import("@/lib/import/check");
import type { Existing } from "@/lib/import/check";

const NONE: Existing = { bankTxns: [], pjReceipts: [], bankRules: [] };
const TODAY = "2026-11-27";
const check = (kind: "HDFC" | "PAPPYJOE", name: string, data: Uint8Array, existing = NONE) => checkUpload(kind, name, data, existing, TODAY);
const said = (r: { lines: string[] }) => r.lines.join(" ");

const october = () => hdfcFile(bankDays(1, 31));
const pjOct = (prefix = "SDCCP") =>
  pappyJoeFile([
    { date: "2026-10-03", receipt: "R1", amount: 1500, prefix },
    { date: "2026-10-04", receipt: "R2", amount: 800, mode: "UPI PAYMENT", prefix },
    { date: "2026-10-05", receipt: "R3", amount: 2500, mode: "DEBIT CARD", prefix },
  ]);

async function upload(fields: { bank?: File[]; pappyjoe?: File[] }) {
  const f = new FormData();
  for (const x of fields.bank ?? []) f.append("bank", x);
  for (const x of fields.pappyjoe ?? []) f.append("pappyjoe", x);
  return importFiles({}, f);
}

beforeEach(resetStore);

describe("accepts the two expected files", () => {
  it("reads a good HDFC statement", () => {
    const r = check("HDFC", "Acct_Statement.xls", october());
    expect(r.ok).toBe(true);
    if (r.ok && r.kind === "HDFC") expect(r.txns).toHaveLength(62);
  });

  it("reads a good PappyJoe Payments export and finds the clinic", () => {
    const r = check("PAPPYJOE", "payments.xlsx", pjOct("SDCCM"));
    expect(r.ok).toBe(true);
    if (r.ok && r.kind === "PAPPYJOE") expect(r.clinic).toBe("SDC2");
  });
});

describe("turns away anything else, saying why", () => {
  const pdf = new TextEncoder().encode("%PDF-1.7\n1 0 obj << >> endobj");
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);
  const csv = new TextEncoder().encode("Date,Narration,Amount\n01/10/26,TEST,100\n");

  it.each([
    ["a PDF", "statement.xls", pdf, /PDF/],
    ["a photo", "statement.xls", jpeg, /photo/],
    ["a CSV renamed .xls", "statement.xls", csv, /not a real Excel file/],
    ["a .csv", "statement.csv", csv, /Only Excel files/],
    ["an empty file", "statement.xls", new Uint8Array(), /empty/],
    ["a damaged Excel file", "statement.xlsx", new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5]), /could not be opened|neither/],
  ])("%s", (_l, name, data, why) => {
    const r = check("HDFC", name, data);
    expect(r.ok).toBe(false);
    expect(said(r)).toMatch(/Nothing from this file was saved/);
    expect(said(r)).toMatch(why);
  });

  it("a PappyJoe file in the bank box, and the other way round", () => {
    expect(said(check("HDFC", "p.xlsx", pjOct()))).toMatch(/PappyJoe Payments export, but it was put in the box for the HDFC/);
    expect(said(check("PAPPYJOE", "b.xls", october()))).toMatch(/an HDFC bank statement, but it was put in the box for the PappyJoe/);
  });

  it("another bank's statement", () => {
    const sbi = otherSheet([
      ["State Bank of India"],
      ["Txn Date", "Value Date", "Description", "Ref No./Cheque No.", "Debit", "Credit", "Balance"],
      ["1 Oct 2026", "1 Oct 2026", "UPI/TEST", "123", "", "500", "10500"],
    ]);
    const r = check("HDFC", "sbi.xlsx", sbi);
    expect(r.ok).toBe(false);
    expect(said(r)).toMatch(/another bank/);
  });

  it("a credit card statement", () => {
    const cc = otherSheet([["Credit Card Statement"], ["Card No", "XXXX 1234"], ["Payment Due Date", "15/11/2026"], ["Minimum Amount Due", "500"]]);
    expect(said(check("HDFC", "cc.xls", cc))).toMatch(/credit card statement/);
  });

  it("an expense sheet or the old accounts workbook", () => {
    const wb = otherSheet([["Sep PappyJoe Data"], ["SDC 1", "", "SDC 2"], ["Salary", 30000], ["Petty cash", 3500], ["Expenses", 12000]]);
    expect(said(check("PAPPYJOE", "accounts.xlsx", wb))).toMatch(/Expenses are entered in this app/);
  });

  it("an HDFC-looking statement that does not say HDFC anywhere", () => {
    expect(said(check("HDFC", "x.xls", hdfcFile(bankDays(1, 3), { noBankName: true })))).toMatch(/does not say HDFC Bank/);
  });

  it("HDFC-like columns that are not the HDFC ones", () => {
    const header = [...HDFC_HEADER.slice(0, 6), "Balance"];
    expect(said(check("HDFC", "x.xls", hdfcFile(bankDays(1, 3), { header })))).toMatch(/column headings are not the usual HDFC ones/);
    const swapped = [...HDFC_HEADER];
    [swapped[4], swapped[5]] = [swapped[5], swapped[4]];
    expect(check("HDFC", "x.xls", hdfcFile(bankDays(1, 3), { header: swapped })).ok).toBe(false);
  });

  it("an HDFC statement whose totals do not match its summary (edited or cut)", () => {
    expect(said(check("HDFC", "x.xls", hdfcFile(bankDays(1, 5), { badTotals: true })))).toMatch(/Totals do not match/);
  });

  it("an HDFC statement without its summary", () => {
    expect(said(check("HDFC", "x.xls", hdfcFile(bankDays(1, 5), { noSummary: true })))).toMatch(/SUMMARY at the end is missing/);
  });

  it.each([
    ["a date that does not exist", [0, 0, "31/02/26"], /could not read the date/],
    ["a date in the future", [0, 0, "15/12/26"], /in the future/],
    ["an amount that is not a number", [1, 4, "12a0"], /not a number/],
  ] as const)("HDFC with %s", (_l, poke, why) => {
    const r = check("HDFC", "x.xls", hdfcFile(bankDays(1, 3), { poke: [...poke] as [number, number, string] }));
    expect(r.ok).toBe(false);
    expect(said(r)).toMatch(why);
  });

  it("PappyJoe export without the Receipt No column", () => {
    const header = PJ_HEADER.filter((h) => h !== "Receipt No");
    expect(said(check("PAPPYJOE", "p.xlsx", pappyJoeFile([{ date: "2026-10-01", receipt: "R1", amount: 100 }], header)))).toMatch(
      /Missing column\(s\): Receipt No/,
    );
  });

  it.each([
    ["patients from no known clinic", [{ date: "2026-10-01", receipt: "R1", amount: 100, prefix: "ABC" }], /which clinic/],
    ["the same receipt twice", [{ date: "2026-10-01", receipt: "R1", amount: 100 }, { date: "2026-10-02", receipt: "R1", amount: 50 }], /appears twice/],
    ["an amount that is not a number", [{ date: "2026-10-01", receipt: "R1", amount: "abc" }], /not a number/],
    ["a date in the future", [{ date: "2027-01-01", receipt: "R1", amount: 100 }], /in the future/],
    ["a date that does not exist", [{ date: "2026-02-30", receipt: "R1", amount: 100 }], /could not read the date/],
  ])("PappyJoe with %s", (_l, receipts, why) => {
    const r = check("PAPPYJOE", "p.xlsx", pappyJoeFile(receipts));
    expect(r.ok).toBe(false);
    expect(said(r)).toMatch(why);
  });

  it("a statement from a different account for dates already imported", () => {
    const existing = { ...NONE, bankTxns: [1, 2, 3, 4].map((d) => ({ date: `2026-10-0${d}`, fingerprint: `other-account-${d}` })) };
    expect(said(check("HDFC", "x.xls", october(), existing))).toMatch(/different bank account or an edited statement/);
  });
});

describe("import action: a bad file writes nothing, a good one is saved once", () => {
  it("imports the good files and rejects the rest, without touching the ledger for them", async () => {
    const before = await getStore().read();
    const res = await upload({
      bank: [asFile(october(), "oct.xls"), asFile(new TextEncoder().encode("%PDF-1.4"), "scan.xls")],
      pappyjoe: [asFile(pjOct(), "podanur.xlsx"), asFile(october(), "wrong-box.xls")],
    });
    const byName = Object.fromEntries(res.results!.map((r) => [r.file, r]));
    expect(byName["oct.xls"].ok).toBe(true);
    expect(byName["podanur.xlsx"].ok).toBe(true);
    expect(byName["scan.xls"].ok).toBe(false);
    expect(byName["wrong-box.xls"].ok).toBe(false);

    const after = await getStore().read();
    expect(after.bankTxns.length - before.bankTxns.length).toBe(62);
    expect(after.pjReceipts.length - before.pjReceipts.length).toBe(3);
    expect(after.cardPayments.length - before.cardPayments.length).toBe(1);
    expect(after.expenses).toEqual(before.expenses);
  });

  it("asks for a file when both boxes are empty", async () => {
    expect((await upload({})).error).toMatch(/Choose the HDFC statement/);
  });

  it("re-importing the same files, or an overlapping period, adds nothing twice", async () => {
    await upload({ bank: [asFile(hdfcFile(bankDays(1, 20)), "a.xls")], pappyjoe: [asFile(pjOct(), "p.xlsx")] });
    const again = await upload({ bank: [asFile(hdfcFile(bankDays(1, 20)), "a.xls")], pappyjoe: [asFile(pjOct(), "p.xlsx")] });
    expect(again.results!.map((r) => r.ok)).toEqual([true, true]);
    expect(said(again.results![0])).toMatch(/0 new rows, 40 already imported/);
    expect(said(again.results![1])).toMatch(/0 new payments, 3 already imported/);

    // 15 Oct to 31 Oct overlaps days 15-20. Same rows, same running balance, so only days 21-31 are new.
    const opening = 100000 + bankDays(1, 14).reduce((a, t) => a + (t.in ?? 0) - (t.out ?? 0), 0);
    const overlap = await upload({ bank: [asFile(hdfcFile(bankDays(15, 31), { opening }), "b.xls")] });
    expect(overlap.results![0].ok).toBe(true);
    expect(said(overlap.results![0])).toMatch(/22 new rows, 12 already imported/);
    const d = await getStore().read();
    expect(new Set(d.bankTxns.map((t) => t.fingerprint)).size).toBe(d.bankTxns.length);
    expect(d.cardPayments.filter((c) => c.pjReceiptId).length).toBe(1);
  });

  it("says so when a receipt changed in PappyJoe since it was imported, and keeps the earlier values", async () => {
    await upload({ pappyjoe: [asFile(pjOct(), "p.xlsx")] });
    const edited = pappyJoeFile([
      { date: "2026-10-03", receipt: "R1", amount: 1600 },
      { date: "2026-10-04", receipt: "R2", amount: 800, mode: "UPI PAYMENT" },
    ]);
    const res = await upload({ pappyjoe: [asFile(edited, "p2.xlsx")] });
    expect(said(res.results![0])).toMatch(/1 receipt\(s\) were imported before with a different/);
    expect((await getStore().read()).pjReceipts.find((r) => r.receiptNo === "R1")!.amount).toBe(1500);
  });

  it("keeps a copy of the original file that can be downloaded", async () => {
    const data = october();
    await upload({ bank: [asFile(data, "oct.xls")] });
    const [batch] = await getStore().listImports(1);
    expect(batch.filePath).toMatch(/^hdfc\/2026-10\//);
    const kept = await getStore().getImportFile(batch.id);
    expect(kept?.name).toBe("oct.xls");
    expect(Buffer.from(kept!.data).equals(Buffer.from(data))).toBe(true);
  });

  it("when saving fails part way, reports it and removes the kept copy", async () => {
    const store = getStore();
    const spy = vi.spyOn(store, "importBank").mockRejectedValueOnce(new Error("connection lost"));
    const remove = vi.spyOn(store, "removeImportFile");
    const res = await upload({ bank: [asFile(october(), "oct.xls")] });
    expect(res.results![0].ok).toBe(false);
    expect(said(res.results![0])).toMatch(/nothing from this file was kept/);
    expect(remove).toHaveBeenCalledOnce();
    spy.mockRestore();
    remove.mockRestore();
  });
});

describe("delete imported data for a month", () => {
  async function seedTwoMonths() {
    const oct = bankDays(1, 31);
    const nov = bankDays(1, 5, "11");
    const opening = 100000;
    await upload({
      bank: [asFile(hdfcFile([...oct, ...nov], { opening }), "oct-nov.xls")],
      pappyjoe: [asFile(pjOct("SDCCP"), "podanur.xlsx"), asFile(pjOct("SDCCM"), "mlmpty.xlsx")],
    });
  }
  const target = (t: string, month: string, confirm?: string) => form({ target: t, month, ...(confirm !== undefined ? { confirm } : {}) });

  it("shows exactly what will go, and changes nothing", async () => {
    await seedTwoMonths();
    const before = await getStore().read();
    const { preview } = await previewMonthDelete({}, target("HDFC", "2026-10"));
    expect(preview).toMatchObject({ rows: 62, firstDate: "2026-10-01", lastDate: "2026-10-31" });
    expect(preview!.moneyIn).toBe(bankDays(1, 31).reduce((a, t) => a + (t.in ?? 0), 0));
    const pj = (await previewMonthDelete({}, target("PAPPYJOE:SDC1", "2026-10"))).preview!;
    expect(pj).toMatchObject({ rows: 3, cards: 1, creditedCards: 0, moneyIn: 4800 });
    expect(await getStore().read()).toEqual(before);
  });

  it("needs the month typed to confirm", async () => {
    await seedTwoMonths();
    const res = await deleteImportedMonth({}, target("HDFC", "2026-10", "2026-11"));
    expect(res.error).toMatch(/Type 2026-10/);
    expect((await getStore().read()).bankTxns.filter((t) => t.date.startsWith("2026-10"))).toHaveLength(62);
  });

  it("deletes only that month's bank rows, records it, and the month can be imported again", async () => {
    await seedTwoMonths();
    const before = await getStore().read();
    const res = await deleteImportedMonth({}, target("HDFC", "2026-10", "2026-10"));
    expect(res.done).toMatch(/Deleted 62 HDFC bank statement rows for 2026-10/);

    const after = await getStore().read();
    expect(after.bankTxns.filter((t) => t.date.startsWith("2026-10"))).toHaveLength(0);
    expect(after.bankTxns.filter((t) => t.date.startsWith("2026-11"))).toHaveLength(10);
    // Nothing else is touched.
    expect(after.expenses).toEqual(before.expenses);
    expect(after.bankRules).toEqual(before.bankRules);
    expect(after.categories).toEqual(before.categories);
    expect(after.payees).toEqual(before.payees);
    expect(after.pjReceipts).toEqual(before.pjReceipts);
    expect(after.reconNotes).toEqual(before.reconNotes);
    expect(after.pettyCashTransfers).toEqual(before.pettyCashTransfers);

    const [log] = await getStore().listImportDeletions(5);
    expect(log).toMatchObject({ source: "HDFC", month: "2026-10", rowsDeleted: 62, deletedBy: ADMIN.id });

    const again = await upload({ bank: [asFile(hdfcFile([...bankDays(1, 31), ...bankDays(1, 5, "11")]), "oct-nov.xls")] });
    expect(said(again.results![0])).toMatch(/62 new rows, 10 already imported/);
  });

  it("deletes one clinic's PappyJoe month with the card payments made from it, never hand-entered ones", async () => {
    await seedTwoMonths();
    const before = await getStore().read();
    const manualCards = before.cardPayments.filter((c) => !c.pjReceiptId);
    const res = await deleteImportedMonth({}, target("PAPPYJOE:SDC1", "2026-10", "2026-10"));
    expect(res.done).toMatch(/Deleted 3 PappyJoe payments for SDC 1.*1 pending card payment/);

    const after = await getStore().read();
    expect(after.pjReceipts.filter((r) => r.clinic === "SDC1")).toHaveLength(0);
    expect(after.pjReceipts.filter((r) => r.clinic === "SDC2")).toHaveLength(3);
    expect(after.cardPayments.filter((c) => !c.pjReceiptId)).toEqual(manualCards);
    expect(after.cardPayments.filter((c) => c.pjReceiptId && c.clinic === "SDC2")).toHaveLength(1);
    expect(after.bankTxns).toEqual(before.bankTxns);
  });

  it("refuses while a card payment from that month is marked credited, and changes nothing", async () => {
    await seedTwoMonths();
    const card = (await getStore().read()).cardPayments.find((c) => c.pjReceiptId && c.clinic === "SDC1")!;
    await getStore().markCardCredited(card.id, "2026-10-20");
    const before = await getStore().read();

    const { preview } = await previewMonthDelete({}, target("PAPPYJOE:SDC1", "2026-10"));
    expect(preview!.creditedCards).toBe(1);
    const res = await deleteImportedMonth({}, target("PAPPYJOE:SDC1", "2026-10", "2026-10"));
    expect(res.error).toMatch(/already marked as credited/);
    expect(await getStore().read()).toEqual(before);
    expect(await getStore().listImportDeletions(5)).toHaveLength(0);
  });

  it("says when there is nothing to delete, and refuses a made-up target", async () => {
    expect((await deleteImportedMonth({}, target("HDFC", "2025-01", "2025-01"))).error).toMatch(/no imported data/);
    expect((await deleteImportedMonth({}, target("EXPENSES", "2026-10", "2026-10"))).error).toMatch(/Choose what to delete/);
    expect((await previewMonthDelete({}, target("HDFC", "2026-13"))).error).toMatch(/Choose a month/);
  });
});
