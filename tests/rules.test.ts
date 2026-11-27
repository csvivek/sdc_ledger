import { describe, expect, it } from "vitest";
import { classify, findDuplicateRule, normalisePattern } from "@/lib/import/rules";
import type { BankRule } from "@/lib/types";

const rules: BankRule[] = [
  { id: "r1", pattern: "TPT-PETTY CASH", matchType: "contains", action: "PETTY_CASH", priority: 10 },
  { id: "r2", pattern: "Zahn  Artz", matchType: "contains", action: "EXPENSE", category: "Lab", priority: 20 },
  { id: "r3", pattern: "-RENT$", matchType: "regex", action: "EXPENSE", category: "Rent", priority: 40 },
];

describe("normalisePattern", () => {
  it("ignores case, outer spaces and repeated spaces", () => {
    expect(normalisePattern("  zahn   artz ")).toBe("ZAHN ARTZ");
  });
});

describe("findDuplicateRule", () => {
  it("finds a rule with the same text in any case and spacing", () => {
    expect(findDuplicateRule({ pattern: "zahn artz", matchType: "contains" }, rules)?.id).toBe("r2");
    expect(findDuplicateRule({ pattern: " TPT-petty  cash ", matchType: "contains" }, rules)?.id).toBe("r1");
  });

  it("treats the same text with a different match type as a different rule", () => {
    expect(findDuplicateRule({ pattern: "ZAHN ARTZ", matchType: "regex" }, rules)).toBeUndefined();
  });

  it("does not count the rule being edited as its own duplicate", () => {
    expect(findDuplicateRule({ pattern: "ZAHN ARTZ", matchType: "contains" }, rules, "r2")).toBeUndefined();
  });

  it("finds nothing for new text", () => {
    expect(findDuplicateRule({ pattern: "BIOWASTE", matchType: "contains" }, rules)).toBeUndefined();
  });
});

describe("classify", () => {
  it("uses the lowest-numbered matching rule", () => {
    const c = classify({ narration: "UPI-ZAHN  ARTZ-RENT", withdrawal: 500, deposit: 0 }, rules);
    expect(c).toMatchObject({ kind: "EXPENSE", category: "Lab", ruleId: "r2" });
  });

  it("asks when no rule matches a debit", () => {
    expect(classify({ narration: "SOMETHING NEW", withdrawal: 500, deposit: 0 }, rules).kind).toBe("UNKNOWN_OUT");
  });
});
