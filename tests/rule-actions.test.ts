import { beforeEach, describe, expect, it, vi } from "vitest";
import { ADMIN, form, resetStore } from "./helpers";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAdmin: vi.fn(async () => ADMIN), requireUser: vi.fn(async () => ADMIN) }));

const { getStore } = await import("@/lib/data/store");
const { saveRule, deleteRule, categoriseDebit } = await import("@/app/import/actions");

const debit = (narration: string, n: number) => ({
  date: "2026-10-0" + n,
  narration,
  refNo: "REF" + n,
  valueDate: "2026-10-0" + n,
  withdrawal: 1000 + n,
  deposit: 0,
  balance: 50000,
  kind: "UNKNOWN_OUT" as const,
  fingerprint: "fp-" + narration + n,
});

async function seedDebits() {
  await getStore().importBank([debit("UPI-NEW PLUMBER-OK", 1), debit("UPI-NEW PLUMBER-AGAIN", 2), debit("NEFT-MYSTERY", 3)], {
    fileName: "test.xls",
    importedBy: ADMIN.id,
  });
  return (await getStore().read()).bankTxns;
}

const ruleForm = (o: Record<string, string> = {}) =>
  form({ pattern: "NEW PLUMBER", matchType: "contains", choice: "EXPENSE:Miscellaneous", clinic: "", priority: "50", ...o });

beforeEach(resetStore);

describe("saveRule: checks the fields", () => {
  it.each([
    [{ pattern: "x" }, /2 to 200 characters/],
    [{ matchType: "glob" }, /how to match/],
    [{ matchType: "regex", pattern: "CHAIR (REPAIR" }, /not valid/],
    [{ priority: "0" }, /1 to 999/],
    [{ priority: "1.5" }, /1 to 999/],
    [{ priority: "1000" }, /1 to 999/],
    [{ choice: "EXPENSE:No such category" }, /category from the list/],
    [{ choice: "SOMETHING" }, /what the payment means/],
  ])("refuses %o", async (fields, message) => {
    const before = (await getStore().read()).bankRules.length;
    const res = await saveRule({}, ruleForm(fields));
    expect(res.error).toMatch(message);
    expect((await getStore().read()).bankRules.length).toBe(before);
  });
});

describe("saveRule: adding", () => {
  it("adds a rule and categorises the unanswered payments it matches", async () => {
    await seedDebits();
    const res = await saveRule({}, ruleForm());
    expect(res.ok).toMatch(/Rule added\. 2 unanswered payment/);
    const d = await getStore().read();
    const rule = d.bankRules.find((r) => r.pattern === "NEW PLUMBER")!;
    expect(rule).toMatchObject({ action: "EXPENSE", category: "Miscellaneous", priority: 50 });
    const matched = d.bankTxns.filter((t) => t.ruleId === rule.id);
    expect(matched).toHaveLength(2);
    expect(d.bankTxns.find((t) => t.narration === "NEFT-MYSTERY")!.kind).toBe("UNKNOWN_OUT");
  });

  it("softly declines a second rule for the same text, any case or spacing", async () => {
    const before = (await getStore().read()).bankRules.length;
    const res = await saveRule({}, ruleForm({ pattern: "  zahn   artz ", choice: "PETTY_CASH" }));
    expect(res.error).toBeUndefined();
    expect(res.notice).toMatch(/Not saved: there is already a rule for "ZAHN ARTZ"/);
    expect((await getStore().read()).bankRules.length).toBe(before);
  });

  it("allows the same text as a regex rule when a contains rule exists", async () => {
    const res = await saveRule({}, ruleForm({ pattern: "ZAHN ARTZ", matchType: "regex" }));
    expect(res.ok).toMatch(/Rule added/);
  });

  it("drops the clinic on non-expense rules", async () => {
    await saveRule({}, ruleForm({ pattern: "OWN TRANSFER", choice: "TRANSFER_OUT", clinic: "SDC1" }));
    const r = (await getStore().read()).bankRules.find((x) => x.pattern === "OWN TRANSFER")!;
    expect(r.action).toBe("TRANSFER_OUT");
    expect(r.clinic).toBeUndefined();
  });
});

describe("saveRule: editing", () => {
  it("lets a rule keep its own text while changing other fields", async () => {
    const zahn = (await getStore().read()).bankRules.find((r) => r.pattern === "ZAHN ARTZ")!;
    const res = await saveRule({}, ruleForm({ id: zahn.id, pattern: "zahn artz", choice: "EXPENSE:Lab", clinic: "SDC2", priority: "25" }));
    expect(res.ok).toMatch(/Rule saved/);
    const after = (await getStore().read()).bankRules.find((r) => r.id === zahn.id)!;
    expect(after).toMatchObject({ pattern: "zahn artz", clinic: "SDC2", priority: 25 });
  });

  it("refuses an edit that turns one rule into a copy of another", async () => {
    const zahn = (await getStore().read()).bankRules.find((r) => r.pattern === "ZAHN ARTZ")!;
    const res = await saveRule({}, ruleForm({ id: zahn.id, pattern: "BIOWASTE" }));
    expect(res.notice).toMatch(/already a rule for "BIOWASTE"/);
    expect((await getStore().read()).bankRules.find((r) => r.id === zahn.id)!.pattern).toBe("ZAHN ARTZ");
  });

  it("says so when the rule was deleted meanwhile", async () => {
    const res = await saveRule({}, ruleForm({ id: "rule_gone" }));
    expect(res.error).toMatch(/no longer exists/);
  });

  it("re-categorises payments the rule had set only when asked", async () => {
    await seedDebits();
    await saveRule({}, ruleForm());
    const rule = (await getStore().read()).bankRules.find((r) => r.pattern === "NEW PLUMBER")!;

    await saveRule({}, ruleForm({ id: rule.id, choice: "EXPENSE:Lab" }));
    let linked = (await getStore().read()).bankTxns.filter((t) => t.ruleId === rule.id);
    expect(linked.every((t) => t.category === "Miscellaneous")).toBe(true);

    const res = await saveRule({}, ruleForm({ id: rule.id, choice: "EXPENSE:Lab", updateLinked: "1" }));
    expect(res.ok).toMatch(/2 payment\(s\) it had categorised were updated/);
    linked = (await getStore().read()).bankTxns.filter((t) => t.ruleId === rule.id);
    expect(linked.every((t) => t.category === "Lab")).toBe(true);
  });
});

describe("deleteRule", () => {
  it("removes the rule", async () => {
    const zahn = (await getStore().read()).bankRules.find((r) => r.pattern === "ZAHN ARTZ")!;
    expect((await deleteRule({}, form({ id: zahn.id }))).ok).toBe("Rule deleted.");
    expect((await getStore().read()).bankRules.some((r) => r.id === zahn.id)).toBe(false);
  });
});

describe("categoriseDebit: Remember never adds a duplicate rule", () => {
  const answer = (id: string, o: Record<string, string> = {}) =>
    form({ id, choice: "EXPENSE:Miscellaneous", clinic: "SHARED", remember: "1", pattern: "NEW PLUMBER", ...o });

  it("adds a new rule and applies it to the other matching payment", async () => {
    const txns = await seedDebits();
    const res = await categoriseDebit({}, answer(txns[0].id));
    expect(res).toMatchObject({ saved: true });
    expect(res.notice).toBeUndefined();
    const d = await getStore().read();
    expect(d.bankRules.filter((r) => r.pattern === "NEW PLUMBER")).toHaveLength(1);
    expect(d.bankTxns.filter((t) => t.narration.includes("PLUMBER")).every((t) => t.kind === "EXPENSE")).toBe(true);
  });

  it("links to the existing rule when it means the same thing", async () => {
    const txns = await seedDebits();
    await saveRule({}, form({ pattern: "MYSTERY", matchType: "contains", choice: "EXPENSE:Miscellaneous", clinic: "SHARED", priority: "50" }));
    // The rule already answered NEFT-MYSTERY; answer a plumber payment and remember "mystery".
    const before = (await getStore().read()).bankRules.length;
    const res = await categoriseDebit({}, answer(txns[0].id, { pattern: " mystery " }));
    expect(res.saved).toBe(true);
    expect(res.notice).toMatch(/already exists, so it was not added again/);
    const d = await getStore().read();
    expect(d.bankRules.length).toBe(before);
    const rule = d.bankRules.find((r) => r.pattern === "MYSTERY")!;
    expect(d.bankTxns.find((t) => t.id === txns[0].id)!.ruleId).toBe(rule.id);
  });

  it("saves the payment but not the rule when the existing rule means something else", async () => {
    const txns = await seedDebits();
    const before = (await getStore().read()).bankRules.length;
    const res = await categoriseDebit({}, answer(txns[0].id, { pattern: "zahn artz" }));
    expect(res.saved).toBe(true);
    expect(res.notice).toMatch(/already exists \(#20, Lab\), so the new rule was not added/);
    const d = await getStore().read();
    expect(d.bankRules.length).toBe(before);
    const t = d.bankTxns.find((x) => x.id === txns[0].id)!;
    expect(t).toMatchObject({ kind: "EXPENSE", category: "Miscellaneous" });
    expect(t.ruleId).toBeUndefined();
  });

  it("explains instead of failing silently", async () => {
    const txns = await seedDebits();
    expect((await categoriseDebit({}, answer("nope"))).error).toMatch(/not found/);
    expect((await categoriseDebit({}, answer(txns[0].id, { choice: "" }))).error).toMatch(/Pick what/);
    expect((await categoriseDebit({}, answer(txns[0].id, { pattern: "x" }))).error).toMatch(/at least 2 letters/);
  });
});
