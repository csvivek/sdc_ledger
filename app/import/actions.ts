"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { getStore } from "@/lib/data/store";
import { readSheetRows } from "@/lib/import/read-sheet";
import { isHdfcStatement, parseHdfc } from "@/lib/import/hdfc";
import { isPappyJoePayments, parsePappyJoe } from "@/lib/import/pappyjoe";
import { classify, findDuplicateRule, normalisePattern } from "@/lib/import/rules";
import { BANK_KIND_LABEL, CLINIC_LABEL, type BankRule, type BankTxn, type ClinicOrShared, type ReconNote } from "@/lib/types";

export interface FileResult {
  file: string;
  ok: boolean;
  lines: string[];
}
export type ImportState = { results?: FileResult[]; error?: string };

const MAX_FILE = 4 * 1024 * 1024;
const MAX_FILES = 8;
const inr = (n: number) => "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

export async function importFiles(_prev: ImportState, formData: FormData): Promise<ImportState> {
  const user = await requireAdmin();
  const files = formData.getAll("files").filter((f): f is File => typeof f === "object" && "arrayBuffer" in f && f.size > 0);
  if (!files.length) return { error: "Choose at least one file." };
  if (files.length > MAX_FILES) return { error: `Upload at most ${MAX_FILES} files at a time.` };

  const store = getStore();
  const { bankRules } = await store.read();
  const results: FileResult[] = [];

  for (const f of files) {
    const res: FileResult = { file: f.name, ok: false, lines: [] };
    results.push(res);
    if (f.size > MAX_FILE) {
      res.lines.push("File is larger than 4 MB; is this the right file?");
      continue;
    }
    let rows;
    try {
      rows = readSheetRows(Buffer.from(await f.arrayBuffer()));
    } catch {
      res.lines.push("Could not open this as a spreadsheet (.xls or .xlsx).");
      continue;
    }

    try {
      if (isHdfcStatement(rows)) {
        const p = parseHdfc(rows);
        if (p.errors.length) {
          res.lines.push("Not imported, because the file did not read cleanly:", ...p.errors);
          continue;
        }
        const txns: Omit<BankTxn, "id">[] = p.rows.map((r) => ({ ...r, ...classify(r, bankRules) }));
        const out = await store.importBank(txns, { fileName: f.name, importedBy: user.id });
        const dates = p.rows.map((r) => r.date).sort();
        const debits = txns.filter((t) => t.withdrawal > 0);
        const unknown = debits.filter((t) => t.kind === "UNKNOWN_OUT").length;
        res.ok = true;
        res.lines.push(
          `HDFC statement ${dates[0]} to ${dates[dates.length - 1]}: ${out.added} new rows, ${out.skipped} already imported.`,
          ...p.checks,
          `${debits.length - unknown} of ${debits.length} debits categorised automatically${unknown ? `; ${unknown} need your answer below` : ""}.`,
        );
      } else if (isPappyJoePayments(rows)) {
        const p = parsePappyJoe(rows, f.name);
        if (p.errors.length || !p.clinic) {
          res.lines.push("Not imported, because the file did not read cleanly:", ...p.errors);
          continue;
        }
        const out = await store.importPappyJoe(p.clinic, p.rows, { fileName: f.name, importedBy: user.id });
        const dates = p.rows.map((r) => r.date).sort();
        const neg = p.rows.filter((r) => r.amount < 0);
        res.ok = true;
        res.lines.push(
          `PappyJoe, ${CLINIC_LABEL[p.clinic]}, ${dates[0]} to ${dates[dates.length - 1]}: ${out.added} new payments, ${out.skipped} already imported.`,
          ...p.warnings,
        );
        if (out.cardsAdded) res.lines.push(`${out.cardsAdded} card payment(s) added to Card income as pending.`);
        if (neg.length)
          res.lines.push(`${neg.length} negative amount(s) (${neg.map((r) => inr(r.amount)).join(", ")}) are listed on Reconcile for you to confirm.`);
      } else {
        res.lines.push("Not recognised. Expected an HDFC account statement or a PappyJoe Payments export.");
      }
    } catch (err) {
      console.error("import failed", f.name, err);
      res.ok = false;
      res.lines.push("Could not save this file. Please try again.");
    }
  }
  revalidatePath("/", "layout");
  return { results };
}

const CLINIC_VALUES: ClinicOrShared[] = ["SDC1", "SDC2", "SHARED"];

export type DebitFormState = { error?: string; saved?: boolean; notice?: string };

/**
 * The admin says what a bank debit is, and optionally saves that as a rule for next time.
 * Returns a message instead of failing silently, so the form can say what went wrong.
 */
export async function categoriseDebit(_prev: DebitFormState, formData: FormData): Promise<DebitFormState> {
  const user = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const choice = String(formData.get("choice") ?? "");
  const clinicRaw = String(formData.get("clinic") ?? "SHARED") as ClinicOrShared;
  const clinic = CLINIC_VALUES.includes(clinicRaw) ? clinicRaw : "SHARED";
  const remember = formData.get("remember") === "1";
  const pattern = String(formData.get("pattern") ?? "").trim().replace(/\s+/g, " ").slice(0, 200);

  let notice: string | undefined;
  try {
    const store = getStore();
    const d = await store.read();
    const txn = d.bankTxns.find((t) => t.id === id);
    if (!txn || !(txn.withdrawal > 0)) return { error: "This bank payment was not found. Reload the page and try again." };

    let action: BankRule["action"];
    let category: string | undefined;
    if (choice.startsWith("EXPENSE:")) {
      category = choice.slice("EXPENSE:".length);
      if (!d.categories.includes(category)) return { error: `"${category}" is no longer an expense category. Pick another.` };
      action = "EXPENSE";
    } else if (choice === "PETTY_CASH" || choice === "TRANSFER_OUT") {
      action = choice;
    } else return { error: "Pick what this payment is." };
    if (remember && pattern.length < 2) return { error: "Type at least 2 letters to look for, or untick Remember." };

    const ruleClinic = action === "EXPENSE" ? clinic : undefined;
    let ruleId: string | undefined;
    if (remember) {
      // Never add a second rule for the same text. The answer for this payment is still saved.
      const existing = d.bankRules.find((r) => r.matchType === "contains" && normalisePattern(r.pattern) === normalisePattern(pattern));
      if (existing) {
        const sameMeaning =
          existing.action === action && (existing.category ?? undefined) === category && (existing.clinic ?? undefined) === ruleClinic;
        if (sameMeaning) ruleId = existing.id;
        notice = sameMeaning
          ? `Saved. A rule for "${existing.pattern}" already exists, so it was not added again.`
          : `Saved this payment. A rule for "${existing.pattern}" already exists (#${existing.priority}, ${describeRule(existing)}), so the new rule was not added. Change that rule under "Rules for bank payments" if it is wrong.`;
      } else {
        try {
          // Clinic is only stored on the rule when it is not written in the narration.
          const rule = await store.addBankRule({ pattern, matchType: "contains", action, category, clinic: ruleClinic, priority: 50 }, user.id);
          ruleId = rule.id;
          d.bankRules.push(rule);
        } catch (err) {
          // The database refuses a duplicate too (for example two Saves at the same moment).
          if (!isDuplicateRuleError(err)) throw err;
          notice = `Saved. A rule for "${pattern}" already exists, so it was not added again.`;
        }
      }
    }
    await store.updateBankTxn(id, { kind: action, category, clinic: ruleClinic, ruleId });
    if (ruleId) await reapply(d.bankTxns.filter((t) => t.id !== id), d.bankRules);
  } catch (err) {
    console.error("categoriseDebit failed", id, err);
    return { error: "Could not save. Check your connection and press Save again." };
  }
  revalidatePath("/", "layout");
  return { saved: true, notice };
}

function describeRule(r: BankRule) {
  const what = r.action === "EXPENSE" ? (r.category ?? "Expense") : BANK_KIND_LABEL[r.action];
  return r.clinic && r.clinic !== "SHARED" ? `${what}, ${CLINIC_LABEL[r.clinic]}` : what;
}

function isDuplicateRuleError(err: unknown) {
  return err instanceof Error && /bank_rules_pattern_unique|duplicate key/i.test(err.message);
}

/** Runs the rules again over debits that are still waiting for an answer. Never changes a debit someone already decided. */
async function reapply(txns: BankTxn[], rules: BankRule[]) {
  const store = getStore();
  let changed = 0;
  for (const t of txns) {
    if (t.kind !== "UNKNOWN_OUT") continue;
    const c = classify(t, rules);
    if (c.kind === "UNKNOWN_OUT") continue;
    await store.updateBankTxn(t.id, { kind: c.kind, category: c.category, clinic: c.clinic, ruleId: c.ruleId });
    changed++;
  }
  return changed;
}

export async function reapplyRules() {
  await requireAdmin();
  const d = await getStore().read();
  await reapply(d.bankTxns, d.bankRules);
  revalidatePath("/", "layout");
}

export type RuleFormState = { ok?: string; error?: string; notice?: string; savedAt?: number };

/** Reads and checks the rule fields from the edit or add form. */
function readRule(formData: FormData, categories: string[]): Omit<BankRule, "id"> | string {
  const pattern = String(formData.get("pattern") ?? "").trim().replace(/\s+/g, " ");
  const matchType = String(formData.get("matchType") ?? "contains");
  const choice = String(formData.get("choice") ?? "");
  const clinicRaw = String(formData.get("clinic") ?? "") as ClinicOrShared;
  const priority = Number(formData.get("priority"));

  if (pattern.length < 2 || pattern.length > 200) return "The text to look for must be 2 to 200 characters.";
  if (matchType !== "contains" && matchType !== "regex") return "Choose how to match the text.";
  if (matchType === "regex") {
    try {
      new RegExp(pattern, "i");
    } catch {
      return "That pattern is not valid. Check the brackets and special characters, or switch to \"Contains this text\".";
    }
  }
  if (!Number.isInteger(priority) || priority < 1 || priority > 999) return "Order must be a whole number from 1 to 999.";

  let action: BankRule["action"];
  let category: string | undefined;
  if (choice.startsWith("EXPENSE:")) {
    category = choice.slice("EXPENSE:".length);
    if (!categories.includes(category)) return "Choose a category from the list.";
    action = "EXPENSE";
  } else if (choice === "PETTY_CASH" || choice === "TRANSFER_OUT") {
    action = choice;
  } else return "Choose what the payment means.";

  // Clinic only matters for expenses; "" means no clinic on the rule (the narration decides, else Shared).
  const clinic = action === "EXPENSE" && CLINIC_VALUES.includes(clinicRaw) ? clinicRaw : undefined;
  return { pattern, matchType, action, category, clinic, priority };
}

/**
 * Adds a rule (no id) or changes one (id). Then runs the rules over unanswered debits, and,
 * when asked, over the debits this rule had already categorised so they follow the change.
 */
export async function saveRule(_prev: RuleFormState, formData: FormData): Promise<RuleFormState> {
  const user = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const updateLinked = formData.get("updateLinked") === "1";
  try {
    const store = getStore();
    const d = await store.read();
    const rule = readRule(formData, d.categories);
    if (typeof rule === "string") return { error: rule };
    const dup = findDuplicateRule(rule, d.bankRules, id || undefined);
    if (dup) {
      const means = dup.action === "EXPENSE" ? dup.category : BANK_KIND_LABEL[dup.action];
      return {
        notice: `Not saved: there is already a rule for "${dup.pattern}" (#${dup.priority}, ${means}). Edit that rule instead.`,
      };
    }

    let rules: BankRule[];
    let relinked = 0;
    if (id) {
      if (!d.bankRules.some((r) => r.id === id)) return { error: "This rule no longer exists. Reload the page." };
      await store.updateBankRule(id, rule);
      rules = d.bankRules.map((r) => (r.id === id ? { ...rule, id } : r));
      if (updateLinked) {
        for (const t of d.bankTxns) {
          if (t.ruleId !== id || !(t.withdrawal > 0)) continue;
          const c = classify(t, rules);
          await store.updateBankTxn(t.id, { kind: c.kind, category: c.category, clinic: c.clinic, ruleId: c.ruleId });
          relinked++;
        }
      }
    } else {
      const added = await store.addBankRule(rule, user.id);
      rules = [...d.bankRules, added];
    }
    // Debits re-done above are no longer UNKNOWN_OUT in this snapshot, so reapply leaves them alone.
    const answered = await reapply(d.bankTxns, rules);

    const parts = [id ? "Rule saved." : "Rule added."];
    if (relinked) parts.push(`${relinked} payment(s) it had categorised were updated.`);
    if (answered) parts.push(`${answered} unanswered payment(s) now have a category.`);
    revalidatePath("/", "layout");
    return { ok: parts.join(" "), savedAt: Date.now() };
  } catch (err) {
    // The database also refuses duplicate rule text (unique index, if applied), e.g. when two saves race.
    if (/duplicate key|bank_rules_pattern_unique/i.test(String((err as Error)?.message ?? err)))
      return { notice: "Not saved: a rule for this text already exists. Edit that rule instead." };
    console.error("save rule failed", err);
    return { error: "Could not save the rule. Please try again." };
  }
}

export async function deleteRule(_prev: RuleFormState, formData: FormData): Promise<RuleFormState> {
  await requireAdmin();
  try {
    await getStore().deleteBankRule(String(formData.get("id") ?? ""));
  } catch (err) {
    console.error("delete rule failed", err);
    return { error: "Could not delete the rule. Please try again." };
  }
  revalidatePath("/", "layout");
  return { ok: "Rule deleted.", savedAt: Date.now() };
}

const TOPICS: ReconNote["topic"][] = ["UPI", "CASH", "CARD", "EXPENSES"];

export async function saveReconNote(formData: FormData) {
  await requireAdmin();
  const month = String(formData.get("month") ?? "");
  const topic = String(formData.get("topic") ?? "") as ReconNote["topic"];
  if (!/^\d{4}-\d{2}$/.test(month) || !TOPICS.includes(topic)) return;
  await getStore().setReconNote(month, topic, String(formData.get("note") ?? "").slice(0, 1000));
  revalidatePath("/reconciliation");
}
