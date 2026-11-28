"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { randomUUID } from "crypto";
import { getStore, ImportDeleteError, inMonth } from "@/lib/data/store";
import { checkUpload, type Existing } from "@/lib/import/check";
import type { ImportKind } from "@/lib/import/validate";
import { classify, findDuplicateRule, normalisePattern } from "@/lib/import/rules";
import { noteActivity } from "@/lib/note-activity";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { closedMonths } from "@/lib/closed-months";
import { closedMessage, closedMonthFromError } from "@/lib/month-close";
import { monthLabel, monthOf } from "@/lib/calc";
import {
  BANK_KIND_LABEL,
  CLINIC_LABEL,
  type BankRule,
  type BankTxn,
  type ClinicId,
  type ClinicOrShared,
  type ImportBatch,
  type MonthKey,
  type ReconNote,
} from "@/lib/types";

export interface FileResult {
  file: string;
  ok: boolean;
  lines: string[];
}
export type ImportState = { results?: FileResult[]; error?: string };

const MAX_FILES = 8;
const inr = (n: number) => "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
const uploaded = (formData: FormData, field: string) =>
  formData.getAll(field).filter((f): f is File => typeof f === "object" && f !== null && "arrayBuffer" in f && f.size > 0);

const CONTENT_TYPE: Record<string, string> = {
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

/** Where the original file is kept: hdfc/2026-10/<random>-<name>. */
function keptPath(kind: ImportKind, firstDate: string, name: string) {
  const safe = name.replace(/[^A-Za-z0-9._-]+/g, "_").slice(-100) || "file";
  return `${kind.toLowerCase()}/${firstDate.slice(0, 7)}/${randomUUID()}-${safe}`;
}

/**
 * Imports the files from the two boxes: "bank" takes the HDFC statement and
 * "pappyjoe" the PappyJoe Payments exports. Each file is checked in full
 * first (lib/import/check.ts); a file that fails any check writes nothing.
 * A file that passes is saved in one database transaction, and a copy of the
 * original is kept in private storage.
 */
export async function importFiles(_prev: ImportState, formData: FormData): Promise<ImportState> {
  const user = await requireAdmin();
  const picked: [ImportKind, File][] = [
    ...uploaded(formData, "bank").map((f) => ["HDFC", f] as [ImportKind, File]),
    ...uploaded(formData, "pappyjoe").map((f) => ["PAPPYJOE", f] as [ImportKind, File]),
  ];
  if (!picked.length) return { error: "Choose the HDFC statement, a PappyJoe Payments export, or both." };
  if (picked.length > MAX_FILES) return { error: `Upload at most ${MAX_FILES} files at a time.` };

  const store = getStore();
  const d = await store.read();
  const existing: Existing = { bankTxns: [...d.bankTxns], pjReceipts: [...d.pjReceipts], bankRules: d.bankRules };
  // Rows dated in a closed month are never imported. Those already in the ledger are simply duplicates;
  // new ones are counted so the admin knows to reopen the month.
  const closed = await closedMonths();
  const closedNote = (rows: { date: string }[]) => {
    const months = [...new Set(rows.map((r) => monthOf(r.date)))].sort().map(monthLabel).join(", ");
    return `${rows.length} new row(s) dated in closed month(s) ${months} were NOT imported. Reopen the month on Month close to add them.`;
  };
  const results: FileResult[] = [];

  for (const [kind, f] of picked) {
    const res: FileResult = { file: f.name, ok: false, lines: [] };
    results.push(res);
    let data: Uint8Array;
    try {
      data = new Uint8Array(await f.arrayBuffer());
    } catch {
      res.lines.push("Not imported. The file could not be read. Please try again.");
      continue;
    }
    const checked = checkUpload(kind, f.name, data, existing);
    if (!checked.ok) {
      res.lines.push(...checked.lines);
      continue;
    }

    // Leave out rows dated in closed months; the ones not already imported are reported.
    let blocked: { date: string }[] = [];
    if (checked.kind === "HDFC") {
      const have = new Set(existing.bankTxns.map((t) => t.fingerprint));
      blocked = checked.txns.filter((t) => closed.has(monthOf(t.date)) && !have.has(t.fingerprint));
      checked.txns = checked.txns.filter((t) => !closed.has(monthOf(t.date)));
    } else {
      const clinic = checked.clinic;
      const have = new Set(existing.pjReceipts.filter((r) => r.clinic === clinic).map((r) => r.receiptNo));
      blocked = checked.receipts.filter((r) => closed.has(monthOf(r.date)) && !have.has(r.receiptNo));
      checked.receipts = checked.receipts.filter((r) => !closed.has(monthOf(r.date)));
    }
    if (!(checked.kind === "HDFC" ? checked.txns : checked.receipts).length) {
      res.ok = !blocked.length;
      res.lines.push(blocked.length ? closedNote(blocked) : "Every row is in a closed month and already imported. Nothing to add.");
      continue;
    }

    const dates = (checked.kind === "HDFC" ? checked.txns : checked.receipts).map((r) => r.date).sort();
    const ext = f.name.toLowerCase().endsWith(".xlsx") ? "xlsx" : "xls";
    let filePath: string | undefined = keptPath(checked.kind, dates[0], f.name);
    let keptNote: string | undefined;
    try {
      if (!(await store.saveImportFile(filePath, data, CONTENT_TYPE[ext]))) {
        filePath = undefined;
        keptNote = "A copy of the file was not kept, because file storage is not set up yet.";
      }
    } catch (err) {
      console.error("keeping import file failed", f.name, err);
      filePath = undefined;
      keptNote = "A copy of the file could not be kept; the data was still imported.";
    }

    try {
      const meta = { fileName: f.name, importedBy: user.id, filePath };
      if (checked.kind === "HDFC") {
        const out = await store.importBank(checked.txns, meta);
        existing.bankTxns.push(...checked.txns);
        await noteActivity(user, "add", "import_batches", undefined, { after: { fileName: f.name, source: "HDFC", rowsAdded: out.added } });
        const debits = checked.txns.filter((t) => t.withdrawal > 0);
        const unknown = debits.filter((t) => t.kind === "UNKNOWN_OUT").length;
        res.lines.push(
          `HDFC statement ${dates[0]} to ${dates[dates.length - 1]}: ${out.added} new rows, ${out.skipped} already imported.`,
          ...checked.lines,
          `${debits.length - unknown} of ${debits.length} debits categorised automatically${unknown ? `; ${unknown} need your answer below` : ""}.`,
        );
        if (blocked.length) res.lines.push(closedNote(blocked));
      } else {
        const out = await store.importPappyJoe(checked.clinic, checked.receipts, meta);
        existing.pjReceipts.push(...checked.receipts.map((r) => ({ ...r, clinic: checked.clinic })));
        await noteActivity(user, "add", "import_batches", undefined, { after: { fileName: f.name, source: "PAPPYJOE", clinic: checked.clinic, rowsAdded: out.added } });
        const neg = checked.receipts.filter((r) => r.amount < 0);
        res.lines.push(
          `PappyJoe, ${CLINIC_LABEL[checked.clinic]}, ${dates[0]} to ${dates[dates.length - 1]}: ${out.added} new payments, ${out.skipped} already imported.`,
          ...checked.lines,
        );
        if (out.cardsAdded) res.lines.push(`${out.cardsAdded} card payment(s) added to Card income as pending.`);
        if (blocked.length) res.lines.push(closedNote(blocked));
        if (neg.length)
          res.lines.push(`${neg.length} negative amount(s) (${neg.map((r) => inr(r.amount)).join(", ")}) are listed on Reconcile for you to confirm.`);
      }
      res.ok = true;
      if (keptNote) res.lines.push(keptNote);
    } catch (err) {
      console.error("import failed", f.name, err);
      if (filePath) await store.removeImportFile(filePath).catch(() => undefined);
      const m = closedMonthFromError(err);
      res.lines.push(m ? `Not imported. ${closedMessage(m)}` : "Not imported. Saving failed part way, so nothing from this file was kept. Please try again.");
    }
  }
  revalidatePath("/", "layout");
  return { results };
}

// ---------------------------------------------------------------------------
// Delete the imported data for one month
// ---------------------------------------------------------------------------

export interface MonthDeletePreview {
  source: ImportBatch["source"];
  clinic?: ClinicId;
  month: MonthKey;
  label: string;
  rows: number;
  firstDate?: string;
  lastDate?: string;
  /** Bank: credits. PappyJoe: positive payments. */
  moneyIn: number;
  /** Bank: debits. PappyJoe: negative lines (as a positive number). */
  moneyOut: number;
  /** Bank debits someone categorised by hand without saving a rule: these answers are lost. */
  handAnswered: number;
  cards: number;
  creditedCards: number;
}

export type MonthDeleteState = { preview?: MonthDeletePreview; error?: string; done?: string; at?: number };

function readTarget(formData: FormData): { source: ImportBatch["source"]; clinic?: ClinicId; month: MonthKey; label: string } | string {
  const target = String(formData.get("target") ?? "");
  const month = String(formData.get("month") ?? "");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return "Choose a month.";
  if (target === "HDFC") return { source: "HDFC", month, label: "HDFC bank statement rows" };
  if (target === "PAPPYJOE:SDC1" || target === "PAPPYJOE:SDC2") {
    const clinic = target.slice(9) as ClinicId;
    return { source: "PAPPYJOE", clinic, month, label: `PappyJoe payments for ${CLINIC_LABEL[clinic]}` };
  }
  return "Choose what to delete.";
}

/** Step 1: says exactly what would be deleted. Changes nothing. */
export async function previewMonthDelete(_prev: MonthDeleteState, formData: FormData): Promise<MonthDeleteState> {
  await requireAdmin();
  const t = readTarget(formData);
  if (typeof t === "string") return { error: t };
  const d = await getStore().read();
  const base = { ...t, handAnswered: 0, cards: 0, creditedCards: 0 };
  let preview: MonthDeletePreview;
  if (t.source === "HDFC") {
    const gone = d.bankTxns.filter((x) => inMonth(x.date, t.month));
    const dates = gone.map((x) => x.date).sort();
    preview = {
      ...base,
      rows: gone.length,
      firstDate: dates[0],
      lastDate: dates[dates.length - 1],
      moneyIn: round2(gone.reduce((a, x) => a + x.deposit, 0)),
      moneyOut: round2(gone.reduce((a, x) => a + x.withdrawal, 0)),
      handAnswered: gone.filter((x) => x.withdrawal > 0 && x.kind !== "UNKNOWN_OUT" && !x.ruleId).length,
    };
  } else {
    const gone = d.pjReceipts.filter((r) => r.clinic === t.clinic && inMonth(r.date, t.month));
    const ids = new Set(gone.map((r) => r.id));
    const cards = d.cardPayments.filter((c) => c.pjReceiptId && ids.has(c.pjReceiptId));
    const dates = gone.map((r) => r.date).sort();
    preview = {
      ...base,
      rows: gone.length,
      firstDate: dates[0],
      lastDate: dates[dates.length - 1],
      moneyIn: round2(gone.filter((r) => r.amount > 0).reduce((a, r) => a + r.amount, 0)),
      moneyOut: round2(-gone.filter((r) => r.amount < 0).reduce((a, r) => a + r.amount, 0)),
      cards: cards.length,
      creditedCards: cards.filter((c) => c.creditedOn).length,
    };
  }
  return { preview, at: Date.now() };
}

/** Step 2: deletes, once the month has been typed to confirm. All or nothing, and recorded. */
export async function deleteImportedMonth(_prev: MonthDeleteState, formData: FormData): Promise<MonthDeleteState> {
  return { ...(await deleteMonth(formData)), at: Date.now() };
}

async function deleteMonth(formData: FormData): Promise<MonthDeleteState> {
  const user = await requireAdmin();
  const t = readTarget(formData);
  if (typeof t === "string") return { error: t };
  if (String(formData.get("confirm") ?? "").trim() !== t.month) return { error: `Type ${t.month} in the box to confirm.` };
  if ((await closedMonths()).has(t.month)) return { error: `Not deleted. ${closedMessage(t.month)}` };
  try {
    const r = await getStore().deleteImportedMonth(t.source, t.clinic, t.month, user.id);
    revalidatePath("/", "layout");
    const extra = r.cardsDeleted ? ` and ${r.cardsDeleted} pending card payment(s)` : "";
    return {
      done: `Deleted ${r.rowsDeleted} ${t.label} for ${t.month}${extra}. You can import that month again now.`,
    };
  } catch (err) {
    if (err instanceof ImportDeleteError) {
      if (err.code === "NOTHING_TO_DELETE") return { error: `There is no imported data for ${t.label} in ${t.month}.` };
      if (err.code === "CREDITED_CARDS")
        return {
          error: `Not deleted. ${err.count} card payment(s) from this month are already marked as credited on Card income. Untick them there first, so that answer is not lost, then delete again.`,
        };
      if (err.code === "NEEDS_MIGRATION") return { error: "Not deleted. This needs a database update that has not been applied yet." };
      return { error: "Choose what to delete and a month." };
    }
    const m = closedMonthFromError(err);
    if (m) return { error: `Not deleted. ${closedMessage(m)}` };
    console.error("delete imported month failed", t, err);
    return { error: "Not deleted. Nothing was changed. Check your connection and try again." };
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;

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
    if ((await closedMonths()).has(monthOf(txn.date))) return { error: closedMessage(monthOf(txn.date)) };

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
    await noteActivity(user, "change", "bank_transactions", id, {
      before: { narration: txn.narration, date: txn.date, kind: txn.kind, category: txn.category ?? null },
      after: { kind: action, category: category ?? null },
    });
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
  const closed = await closedMonths();
  let changed = 0;
  for (const t of txns) {
    if (t.kind !== "UNKNOWN_OUT" || closed.has(monthOf(t.date))) continue;
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
      const old = d.bankRules.find((r) => r.id === id);
      await store.updateBankRule(id, rule);
      await noteActivity(user, "change", "bank_rules", id, { before: { ...old }, after: { ...rule } });
      rules = d.bankRules.map((r) => (r.id === id ? { ...rule, id } : r));
      if (updateLinked) {
        const closed = await closedMonths();
        for (const t of d.bankTxns) {
          // Payments in a closed month keep what they were given.
          if (t.ruleId !== id || !(t.withdrawal > 0) || closed.has(monthOf(t.date))) continue;
          const c = classify(t, rules);
          await store.updateBankTxn(t.id, { kind: c.kind, category: c.category, clinic: c.clinic, ruleId: c.ruleId });
          relinked++;
        }
      }
    } else {
      const added = await store.addBankRule(rule, user.id);
      await noteActivity(user, "add", "bank_rules", added.id, { after: added });
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
  const user = await requireAdmin();
  try {
    const id = String(formData.get("id") ?? "");
    // Only the fake-data log needs the old rule; on Supabase the database logs it.
    const old = isSupabaseConfigured ? undefined : (await getStore().read()).bankRules.find((r) => r.id === id);
    await getStore().deleteBankRule(id);
    await noteActivity(user, "delete", "bank_rules", id, { before: old ? { ...old } : undefined });
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
  if ((await closedMonths()).has(month)) return; // closed months keep their notes
  await getStore().setReconNote(month, topic, String(formData.get("note") ?? "").slice(0, 1000));
  revalidatePath("/reconciliation");
}
