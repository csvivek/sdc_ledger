"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { getStore } from "@/lib/data/store";
import { readSheetRows } from "@/lib/import/read-sheet";
import { isHdfcStatement, parseHdfc } from "@/lib/import/hdfc";
import { isPappyJoePayments, parsePappyJoe } from "@/lib/import/pappyjoe";
import { classify } from "@/lib/import/rules";
import { CLINIC_LABEL, type BankRule, type BankTxn, type ClinicOrShared, type ReconNote } from "@/lib/types";

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

/** The admin says what a bank debit is, and optionally saves that as a rule for next time. */
export async function categoriseDebit(formData: FormData) {
  const user = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const choice = String(formData.get("choice") ?? "");
  const clinicRaw = String(formData.get("clinic") ?? "SHARED") as ClinicOrShared;
  const clinic = CLINIC_VALUES.includes(clinicRaw) ? clinicRaw : "SHARED";
  const remember = formData.get("remember") === "1";
  const pattern = String(formData.get("pattern") ?? "").trim().replace(/\s+/g, " ").slice(0, 200);

  const store = getStore();
  const d = await store.read();
  const txn = d.bankTxns.find((t) => t.id === id);
  if (!txn || !(txn.withdrawal > 0)) return;

  let action: BankRule["action"];
  let category: string | undefined;
  if (choice.startsWith("EXPENSE:")) {
    category = choice.slice("EXPENSE:".length);
    if (!d.categories.includes(category)) return;
    action = "EXPENSE";
  } else if (choice === "PETTY_CASH" || choice === "TRANSFER_OUT") {
    action = choice;
  } else return;

  let ruleId: string | undefined;
  if (remember && pattern.length >= 2) {
    // Clinic is only stored on the rule when it is not written in the narration.
    const rule = await store.addBankRule(
      { pattern, matchType: "contains", action, category, clinic: action === "EXPENSE" ? clinic : undefined, priority: 50 },
      user.id,
    );
    ruleId = rule.id;
    d.bankRules.push(rule);
  }
  await store.updateBankTxn(id, { kind: action, category, clinic: action === "EXPENSE" ? clinic : undefined, ruleId });
  if (ruleId) await reapply(d.bankTxns.filter((t) => t.id !== id), d.bankRules);
  revalidatePath("/", "layout");
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

export async function deleteRule(formData: FormData) {
  await requireAdmin();
  await getStore().deleteBankRule(String(formData.get("id") ?? ""));
  revalidatePath("/import");
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
