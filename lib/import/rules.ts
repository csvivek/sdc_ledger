// Works out what each bank row is, without asking anyone where possible.
//
// Credits: UPI-... = UPI from a patient, CASH DEPOSIT = cash paid in, anything
// else = other credit (for example card money the doctor passes on).
// Debits: the first matching rule (lowest priority number) decides. No match
// means the admin is asked once, and the answer can be saved as a new rule.

import type { BankRule, BankTxnKind, ClinicOrShared } from "../types";

export interface Classified {
  kind: BankTxnKind;
  category?: string;
  clinic?: ClinicOrShared;
  ruleId?: string;
}

/** SDC1 / SDC 1 / SDC1SAL in the remark -> that clinic. */
export function clinicFromNarration(narration: string): ClinicOrShared | undefined {
  const n = narration.toUpperCase();
  const one = /SDC\s?1(?!\d)/.test(n);
  const two = /SDC\s?2(?!\d)/.test(n);
  if (one && !two) return "SDC1";
  if (two && !one) return "SDC2";
  return undefined;
}

export function ruleMatches(rule: Pick<BankRule, "pattern" | "matchType">, narration: string): boolean {
  const n = narration.toUpperCase();
  if (rule.matchType === "regex") {
    try {
      return new RegExp(rule.pattern, "i").test(narration);
    } catch {
      return false;
    }
  }
  const p = rule.pattern.trim().toUpperCase();
  return p.length > 0 && n.includes(p);
}

export function classify(
  row: { narration: string; withdrawal: number; deposit: number },
  rules: BankRule[],
): Classified {
  const n = row.narration.toUpperCase();
  if (row.deposit > 0) {
    if (n.startsWith("UPI-")) return { kind: "UPI_IN" };
    if (n.includes("CASH DEPOSIT") || n.startsWith("CASH DEP")) return { kind: "CASH_DEPOSIT" };
    return { kind: "OTHER_IN" };
  }
  const sorted = [...rules].sort((a, b) => a.priority - b.priority);
  for (const r of sorted) {
    if (!ruleMatches(r, row.narration)) continue;
    const clinic = clinicFromNarration(row.narration) ?? r.clinic ?? "SHARED";
    if (r.action === "EXPENSE") return { kind: "EXPENSE", category: r.category, clinic, ruleId: r.id };
    if (r.action === "PETTY_CASH") return { kind: "PETTY_CASH", ruleId: r.id };
    return { kind: "TRANSFER_OUT", ruleId: r.id };
  }
  return { kind: "UNKNOWN_OUT", clinic: clinicFromNarration(row.narration) };
}

/**
 * Starting rules, written from the hand-labelled October 2026 statement
 * (PURPOSE column). Kept in the database (bank_rules) so the admin can add to
 * them; this list is also used by the prototype's fake-data mode.
 */
export const SEED_RULES: Omit<BankRule, "id">[] = [
  { pattern: "TPT-PETTY CASH", matchType: "contains", action: "PETTY_CASH", priority: 10 },
  { pattern: "BIOWASTE", matchType: "contains", action: "EXPENSE", category: "Biowaste", priority: 20 },
  { pattern: "TNPDCL", matchType: "contains", action: "EXPENSE", category: "EB (electricity)", priority: 20 },
  { pattern: "ZAHN ARTZ", matchType: "contains", action: "EXPENSE", category: "Lab", priority: 20 },
  { pattern: "RUPAY MDR", matchType: "contains", action: "EXPENSE", category: "Bank charges", priority: 20 },
  { pattern: "SOUND BOX RENTAL", matchType: "contains", action: "EXPENSE", category: "Bank charges", priority: 20 },
  { pattern: "CHAIR (REPAIR|SERVICE)|COMPRESSOR REPAIR", matchType: "regex", action: "EXPENSE", category: "Dental chair service", priority: 30 },
  { pattern: "FLOWERS", matchType: "contains", action: "EXPENSE", category: "Flowers", priority: 30 },
  { pattern: "SDC ?[12]? ?SAL\\b|-SAL$", matchType: "regex", action: "EXPENSE", category: "Salary", priority: 40 },
  { pattern: "-RENT$", matchType: "regex", action: "EXPENSE", category: "Rent", priority: 40 },
  { pattern: "\\bCONS(ULTANT)?\\b", matchType: "regex", action: "EXPENSE", category: "Consultant", priority: 40 },
  { pattern: "-LAB$", matchType: "regex", action: "EXPENSE", category: "Lab", priority: 40 },
];
