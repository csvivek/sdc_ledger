// LedgerStore backed by Supabase. Every call runs as the logged-in user, so
// row level security decides what comes back: admin gets everything, staff
// get categories, clinics, their own profile and their own expenses.

import type { SupabaseClient } from "@supabase/supabase-js";
import { monthRange } from "../expense-view";
import { createClient } from "../supabase/server";
import type {
  CategoryChange,
  BankDeposit,
  BankRule,
  BankTxn,
  ImportBatch,
  ImportDeletion,
  PjReceipt,
  ReconNote,
  CardPayment,
  CategoryInfo,
  ClinicId,
  Expense,
  GapAnswer,
  GapReason,
  GapRule,
  LedgerData,
  MonthKey,
  PappyJoeMonth,
  Payee,
  PayeeKind,
  PettyCashTransfer,
  PettyCount,
  PettyCountReason,
  ReconReason,
  User,
} from "../types";
import type { FormOptions, ImportMeta, ImportResult, LedgerStore, MonthDeleteResult } from "./store";
import { ImportDeleteError } from "./store-errors";

/** The bucket that keeps the original uploaded files (private, admin only). */
const FILES_BUCKET = "import-files";

type PgError = { code?: string; message?: string } | null | undefined;
/** The database function is not there yet: the safe-imports migration has not been applied. */
const missingFunction = (e: PgError) => !!e && (e.code === "PGRST202" || e.code === "42883" || /could not find the function/i.test(e.message ?? ""));
const missingTable = (e: PgError) =>
  !!e && (e.code === "PGRST205" || e.code === "42P01" || e.code === "42703" || /does not exist|could not find the table/i.test(e.message ?? ""));

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function rows<T>(res: { data: Row[] | null; error: { message: string } | null }, map: (r: Row) => T): T[] {
  if (res.error) throw new Error(res.error.message);
  return (res.data ?? []).map(map);
}

/** Escape % and _ so a name is matched literally by ilike. */
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export const toExpense = (r: Row): Expense => ({
  id: r.id,
  date: r.date,
  amount: Number(r.amount),
  category: r.category,
  clinic: r.clinic,
  paidBy: r.paid_by,
  pettyCashClinic: r.petty_cash_clinic ?? undefined,
  note: r.note ?? "",
  payeeId: r.payee_id ?? undefined,
  invoiceNo: r.invoice_no ?? undefined,
  inPappyJoe: r.in_pappyjoe ?? undefined,
  enteredBy: r.entered_by,
  enteredAt: r.entered_at,
});

/** Supabase returns at most 1000 rows per request, so read big tables page by page. */
async function selectAll(sb: SupabaseClient, table: string, order: string): Promise<{ data: Row[] | null; error: { message: string } | null }> {
  const all: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select("*").order(order).order("id").range(from, from + 999);
    if (error) return { data: null, error };
    all.push(...(data ?? []));
    if (!data || data.length < 1000) return { data: all, error: null };
  }
}

const toBankTxn = (r: Row): BankTxn => ({
  id: r.id,
  date: r.txn_date,
  narration: r.narration,
  refNo: r.ref_no ?? "",
  valueDate: r.value_date ?? r.txn_date,
  withdrawal: Number(r.withdrawal),
  deposit: Number(r.deposit),
  balance: Number(r.closing_balance),
  kind: r.kind,
  category: r.category ?? undefined,
  clinic: r.clinic ?? undefined,
  ruleId: r.rule_id ?? undefined,
  fingerprint: r.fingerprint,
});

const toBankRule = (r: Row): BankRule => ({
  id: r.id,
  pattern: r.pattern,
  matchType: r.match_type,
  action: r.action,
  category: r.category ?? undefined,
  clinic: r.clinic ?? undefined,
  priority: r.priority,
});

const toGapReason = (r: Row): GapReason => ({
  id: r.id,
  gapType: r.gap_type,
  label: r.label,
  followUp: Boolean(r.follow_up),
  todo: r.todo ?? undefined,
  code: r.code ?? undefined,
  active: r.active,
});

const toGapRule = (r: Row): GapRule => ({ id: r.id, gapType: r.gap_type, signature: r.signature, reasonId: r.reason_id });

const toGapAnswer = (r: Row): GapAnswer => ({
  gapType: r.gap_type,
  itemKey: r.item_key,
  reasonId: r.reason_id,
  note: r.note ?? "",
  amount: Number(r.amount),
  signature: r.signature ?? undefined,
  answeredBy: r.answered_by ?? undefined,
  answeredAt: r.answered_at,
});

const toReceipt = (r: Row): PjReceipt => ({
  id: r.id,
  clinic: r.clinic,
  date: r.receipt_date,
  patientName: r.patient_name,
  patientId: r.patient_id,
  receiptNo: r.receipt_no,
  invoiceNo: r.invoice_no,
  invoiceTotal: Number(r.invoice_total),
  amount: Number(r.amount),
  mode: r.mode,
  paymentInfo: r.payment_info,
  receiptBy: r.receipt_by,
});

const span = (dates: string[]) => {
  const s = [...dates].sort();
  return { first_date: s[0] ?? null, last_date: s[s.length - 1] ?? null };
};

export const toPayee = (r: Row): Payee => ({
  id: r.id,
  kind: r.kind,
  name: r.name,
  active: r.active,
});

export const toUser = (r: Row): User => ({
  id: r.id,
  name: r.name,
  role: r.role,
  clinic: r.clinic ?? undefined,
});

const toPettyCount = (r: Row): PettyCount => ({
  id: r.id,
  clinic: r.clinic,
  month: r.month,
  counted: Number(r.counted),
  reasonId: r.reason_id ?? undefined,
  note: r.note ?? "",
  countedBy: r.counted_by ?? "",
  countedAt: r.counted_at,
});

const toPettyCountReason = (r: Row): PettyCountReason => ({
  id: r.id,
  code: r.code ?? undefined,
  label: r.label,
  active: r.active,
  sortOrder: r.sort_order,
});

export class SupabaseLedgerStore implements LedgerStore {
  constructor(private client: () => Promise<SupabaseClient> = createClient) {}

  async read(): Promise<LedgerData> {
    const sb = await this.client();
    const [profiles, clinics, categories, payees, expenses, transfers, pj, deposits, reasons, cards, txns, rules, receipts, notes, gapReasons, gapAnswers, gapRules, counts, countReasons] = await Promise.all([
      sb.from("profiles").select("*"),
      sb.from("clinics").select("*"),
      sb.from("categories").select("*").eq("active", true).order("sort_order"),
      sb.from("payees").select("*").order("name"),
      sb.from("expenses").select("*"),
      sb.from("petty_cash_transfers").select("*"),
      sb.from("pappyjoe_income").select("*"),
      sb.from("bank_deposits").select("*"),
      sb.from("recon_reasons").select("*"),
      sb.from("card_payments").select("*"),
      selectAll(sb, "bank_transactions", "txn_date"),
      sb.from("bank_rules").select("*").order("priority"),
      selectAll(sb, "pappyjoe_receipts", "receipt_date"),
      sb.from("recon_notes").select("*"),
      sb.from("gap_reasons").select("*").order("sort_order").order("created_at"),
      selectAll(sb, "gap_answers", "answered_at"),
      sb.from("gap_rules").select("*"),
      sb.from("petty_cash_counts").select("*"),
      sb.from("petty_count_reasons").select("*").order("sort_order"),
    ]);

    const cats = rows(categories, (r) => r);
    const categoryPayeeKind: Record<string, PayeeKind> = {};
    for (const c of cats) if (c.payee_kind) categoryPayeeKind[c.name] = c.payee_kind;

    const opening: Record<ClinicId, number> = { SDC1: 0, SDC2: 0 };
    for (const c of rows(clinics, (r) => r)) opening[c.id as ClinicId] = Number(c.petty_cash_opening);

    return {
      users: rows(profiles, toUser),
      categories: cats.map((r) => r.name as string),
      categoryPayeeKind,
      invoiceCategories: cats.filter((r) => r.needs_invoice).map((r) => r.name as string),
      payees: rows(payees, toPayee),
      expenses: rows(expenses, toExpense),
      pettyCashTransfers: rows(transfers, (r): PettyCashTransfer => ({
        id: r.id,
        date: r.date,
        clinic: r.clinic,
        amount: Number(r.amount),
        note: r.note ?? "",
      })),
      pettyCashOpening: opening,
      pappyJoe: rows(pj, (r): PappyJoeMonth => ({
        month: r.month,
        clinic: r.clinic,
        cash: Number(r.cash),
        upi: Number(r.upi),
        card: Number(r.card),
      })),
      bankDeposits: rows(deposits, (r): BankDeposit => ({
        id: r.id,
        date: r.date,
        clinic: r.clinic,
        kind: r.kind,
        amount: Number(r.amount),
        narration: r.narration ?? "",
      })),
      reconReasons: rows(reasons, (r): ReconReason => ({
        month: r.month,
        clinic: r.clinic,
        reason: r.reason,
        updatedAt: r.updated_at,
      })),
      cardPayments: rows(cards, (r): CardPayment => ({
        id: r.id,
        date: r.date,
        clinic: r.clinic,
        patientRef: r.patient_ref ?? "",
        amount: Number(r.amount),
        creditedOn: r.credited_on ?? undefined,
        pjReceiptId: r.pappyjoe_receipt_id ?? undefined,
      })),
      bankTxns: rows(txns, toBankTxn),
      bankRules: rows(rules, toBankRule),
      pjReceipts: rows(receipts, toReceipt),
      reconNotes: rows(notes, (r): ReconNote => ({ month: r.month, topic: r.topic, note: r.note })),
      gapReasons: rows(gapReasons, toGapReason),
      gapAnswers: rows(gapAnswers, toGapAnswer),
      gapRules: rows(gapRules, toGapRule),
      pettyCounts: rows(counts, toPettyCount),
      pettyCountReasons: rows(countReasons, toPettyCountReason),
    };
  }

  async recentExpenses(limit: number) {
    const sb = await this.client();
    const [expenses, profiles] = await Promise.all([
      sb.from("expenses").select("*").order("entered_at", { ascending: false }).limit(limit),
      sb.from("profiles").select("*"),
    ]);
    return { expenses: rows(expenses, toExpense), users: rows(profiles, toUser) };
  }

  async monthExpenses(month: MonthKey, limit: number) {
    const sb = await this.client();
    const { from, to } = monthRange(month);
    const [expenses, profiles] = await Promise.all([
      sb
        .from("expenses")
        .select("*")
        .gte("date", from)
        .lt("date", to)
        .order("date", { ascending: false })
        .order("entered_at", { ascending: false })
        .limit(limit + 1),
      sb.from("profiles").select("*"),
    ]);
    const all = rows(expenses, toExpense);
    return { expenses: all.slice(0, limit), users: rows(profiles, toUser), more: all.length > limit };
  }

  async firstExpenseDate() {
    const sb = await this.client();
    const { data, error } = await sb.from("expenses").select("date").order("date", { ascending: true }).limit(1);
    if (error) throw new Error(error.message);
    return (data?.[0]?.date as string | undefined) ?? undefined;
  }

  async formOptions(): Promise<FormOptions> {
    const sb = await this.client();
    const [categories, payees] = await Promise.all([
      sb.from("categories").select("name, payee_kind, needs_invoice").eq("active", true).order("sort_order"),
      sb.from("payees").select("*").order("name"),
    ]);
    const cats = rows(categories, (r) => r);
    const categoryPayeeKind: Record<string, PayeeKind> = {};
    for (const c of cats) if (c.payee_kind) categoryPayeeKind[c.name] = c.payee_kind;
    return {
      categories: cats.map((r) => r.name as string),
      categoryPayeeKind,
      invoiceCategories: cats.filter((r) => r.needs_invoice).map((r) => r.name as string),
      payees: rows(payees, toPayee),
    };
  }

  async addExpense(e: Omit<Expense, "id" | "enteredAt">): Promise<Expense> {
    const sb = await this.client();
    const { data, error } = await sb
      .from("expenses")
      .insert({
        date: e.date,
        amount: e.amount,
        category: e.category,
        clinic: e.clinic,
        paid_by: e.paidBy,
        petty_cash_clinic: e.pettyCashClinic ?? null,
        note: e.note,
        payee_id: e.payeeId ?? null,
        invoice_no: e.invoiceNo ?? null,
        in_pappyjoe: e.inPappyJoe ?? null,
        entered_by: e.enteredBy,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return toExpense(data);
  }

  async addPayee(kind: PayeeKind, name: string, createdBy: string): Promise<Payee> {
    const sb = await this.client();
    const clean = name.trim();
    const { data: existing, error: findErr } = await sb.from("payees").select("*").eq("kind", kind).ilike("name", escapeLike(clean));
    if (findErr) throw new Error(findErr.message);
    const found = (existing ?? []).find((r) => String(r.name).trim().toLowerCase() === clean.toLowerCase());
    if (found) return toPayee(found);
    const { data, error } = await sb.from("payees").insert({ kind, name: clean, created_by: createdBy }).select().single();
    if (error) throw new Error(error.message);
    return toPayee(data);
  }

  async setPayeeActive(id: string, active: boolean) {
    const sb = await this.client();
    const { error } = await sb.from("payees").update({ active }).eq("id", id);
    if (error) throw new Error(error.message);
  }

  async listCategories(): Promise<CategoryInfo[]> {
    const sb = await this.client();
    const { data, error } = await sb.from("categories").select("*").order("sort_order").order("name");
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({
      name: r.name,
      active: r.active,
      payeeKind: r.payee_kind ?? undefined,
      needsInvoice: Boolean(r.needs_invoice),
    }));
  }

  async addCategory(name: string) {
    const sb = await this.client();
    const { data: last, error: lastErr } = await sb.from("categories").select("sort_order").order("sort_order", { ascending: false }).limit(1);
    if (lastErr) throw new Error(lastErr.message);
    const sortOrder = Number(last?.[0]?.sort_order ?? 0) + 1;
    const { error } = await sb.from("categories").insert({ name, sort_order: sortOrder });
    if (error) throw new Error(error.message);
  }

  async renameCategory(oldName: string, newName: string) {
    const sb = await this.client();
    // Expenses, bank payments and bank rules reference the name with
    // "on update cascade", so they follow the new name automatically.
    const { data, error } = await sb.from("categories").update({ name: newName }).eq("name", oldName).select("name");
    if (error) throw new Error(error.message);
    if (!data?.length) throw new Error(`Category ${oldName} was not found`);
  }

  async setCategoryActive(name: string, active: boolean) {
    const sb = await this.client();
    const { error } = await sb.from("categories").update({ active }).eq("name", name);
    if (error) throw new Error(error.message);
  }

  async setReconReason(month: MonthKey, clinic: ClinicId, reason: string) {
    const sb = await this.client();
    const text = reason.trim();
    const { error } = text
      ? await sb
          .from("recon_reasons")
          .upsert({ month, clinic, reason: text, updated_at: new Date().toISOString() }, { onConflict: "month,clinic" })
      : await sb.from("recon_reasons").delete().eq("month", month).eq("clinic", clinic);
    if (error) throw new Error(error.message);
  }

  async markCardCredited(id: string, creditedOn: string | undefined) {
    const sb = await this.client();
    const { data, error } = await sb
      .from("card_payments")
      .update({ credited_on: creditedOn ?? null })
      .eq("id", id)
      .select()
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data
      ? {
          id: data.id,
          date: data.date,
          clinic: data.clinic,
          patientRef: data.patient_ref ?? "",
          amount: Number(data.amount),
          creditedOn: data.credited_on ?? undefined,
        }
      : undefined;
  }

  async reset() {
    throw new Error("Reset is only available with fake data.");
  }

  private async addBatch(sb: SupabaseClient, b: Row): Promise<string> {
    const { data, error } = await sb.from("import_batches").insert(b).select("id").single();
    if (error) throw new Error(error.message);
    return data.id;
  }

  private async setBatchAdded(sb: SupabaseClient, id: string, added: number) {
    const { error } = await sb.from("import_batches").update({ rows_added: added }).eq("id", id);
    if (error) throw new Error(error.message);
  }

  async importBank(txns: Omit<BankTxn, "id">[], meta: ImportMeta): Promise<ImportResult> {
    const sb = await this.client();
    const rowsJson = txns.map((t) => ({
      txn_date: t.date,
      narration: t.narration,
      ref_no: t.refNo,
      value_date: t.valueDate,
      withdrawal: t.withdrawal,
      deposit: t.deposit,
      closing_balance: t.balance,
      kind: t.kind,
      category: t.category ?? null,
      clinic: t.clinic ?? null,
      rule_id: t.ruleId ?? null,
      fingerprint: t.fingerprint,
    }));
    const batch = { file_name: meta.fileName, file_path: meta.filePath ?? null, ...span(txns.map((t) => t.date)) };
    // One database transaction: the import record and every row, or nothing.
    const { data, error } = await sb.rpc("import_bank_file", { p_batch: batch, p_rows: rowsJson });
    if (!error) {
      const added = Number(data?.added ?? 0);
      return { read: txns.length, added, skipped: txns.length - added };
    }
    if (!missingFunction(error)) throw new Error(error.message);

    // Before the safe-imports migration: write step by step, and take everything back out if a step fails.
    const batchId = await this.addBatch(sb, { source: "HDFC", rows_read: txns.length, imported_by: meta.importedBy, ...batch, file_path: undefined });
    try {
      let added = 0;
      for (let i = 0; i < rowsJson.length; i += 500) {
        const chunk = rowsJson.slice(i, i + 500).map((r) => ({ ...r, batch_id: batchId }));
        const res = await sb.from("bank_transactions").upsert(chunk, { onConflict: "fingerprint", ignoreDuplicates: true }).select("id");
        if (res.error) throw new Error(res.error.message);
        added += res.data?.length ?? 0;
      }
      await this.setBatchAdded(sb, batchId, added);
      return { read: txns.length, added, skipped: txns.length - added };
    } catch (err) {
      await sb.from("bank_transactions").delete().eq("batch_id", batchId);
      await sb.from("import_batches").delete().eq("id", batchId);
      throw err;
    }
  }

  async importPappyJoe(clinic: ClinicId, receipts: Omit<PjReceipt, "id" | "clinic">[], meta: ImportMeta): Promise<ImportResult> {
    const sb = await this.client();
    const rowsJson = receipts.map((r) => ({
      receipt_date: r.date,
      patient_name: r.patientName,
      patient_id: r.patientId,
      receipt_no: r.receiptNo,
      invoice_no: r.invoiceNo,
      invoice_total: r.invoiceTotal,
      amount: r.amount,
      mode: r.mode,
      payment_info: r.paymentInfo,
      receipt_by: r.receiptBy,
    }));
    const batch = { clinic, file_name: meta.fileName, file_path: meta.filePath ?? null, ...span(receipts.map((r) => r.date)) };
    const { data, error } = await sb.rpc("import_pappyjoe_file", { p_batch: batch, p_rows: rowsJson });
    if (!error) {
      const added = Number(data?.added ?? 0);
      return { read: receipts.length, added, skipped: receipts.length - added, cardsAdded: Number(data?.cards_added ?? 0) };
    }
    if (!missingFunction(error)) throw new Error(error.message);

    // Before the safe-imports migration: step by step, undone on failure (card payments go with their receipts).
    const batchId = await this.addBatch(sb, {
      source: "PAPPYJOE",
      rows_read: receipts.length,
      imported_by: meta.importedBy,
      ...batch,
      file_path: undefined,
    });
    try {
      const inserted: Row[] = [];
      for (let i = 0; i < rowsJson.length; i += 500) {
        const chunk = rowsJson.slice(i, i + 500).map((r) => ({ ...r, batch_id: batchId, clinic }));
        const res = await sb.from("pappyjoe_receipts").upsert(chunk, { onConflict: "clinic,receipt_no", ignoreDuplicates: true }).select("*");
        if (res.error) throw new Error(res.error.message);
        inserted.push(...(res.data ?? []));
      }
      const cards = inserted
        .filter((r) => r.mode === "CARD" && Number(r.amount) > 0)
        .map((r) => ({
          date: r.receipt_date,
          clinic,
          patient_ref: `${r.patient_name} · receipt ${r.receipt_no}`,
          amount: Number(r.amount),
          pappyjoe_receipt_id: r.id,
        }));
      if (cards.length) {
        const res = await sb.from("card_payments").insert(cards);
        if (res.error) throw new Error(res.error.message);
      }
      await this.setBatchAdded(sb, batchId, inserted.length);
      return { read: receipts.length, added: inserted.length, skipped: receipts.length - inserted.length, cardsAdded: cards.length };
    } catch (err) {
      await sb.from("pappyjoe_receipts").delete().eq("batch_id", batchId);
      await sb.from("import_batches").delete().eq("id", batchId);
      throw err;
    }
  }

  async saveImportFile(path: string, data: Uint8Array, contentType: string) {
    const sb = await this.client();
    const { error } = await sb.storage.from(FILES_BUCKET).upload(path, data, { contentType, upsert: false });
    if (!error) return true;
    // No bucket yet (migration not applied): import without keeping the file.
    if (/bucket not found/i.test(error.message)) return false;
    throw new Error(error.message);
  }

  async removeImportFile(path: string) {
    const sb = await this.client();
    await sb.storage.from(FILES_BUCKET).remove([path]);
  }

  async getImportFile(batchId: string) {
    const sb = await this.client();
    const { data: b, error } = await sb.from("import_batches").select("file_name, file_path").eq("id", batchId).maybeSingle();
    if (error || !b?.file_path) return undefined;
    const file = await sb.storage.from(FILES_BUCKET).download(b.file_path);
    if (file.error || !file.data) return undefined;
    return { name: b.file_name as string, data: new Uint8Array(await file.data.arrayBuffer()) };
  }

  async deleteImportedMonth(source: ImportBatch["source"], clinic: ClinicId | undefined, month: string): Promise<MonthDeleteResult> {
    const sb = await this.client();
    const { data, error } = await sb.rpc("delete_imported_month", { p_source: source, p_clinic: clinic ?? null, p_month: month });
    if (error) {
      if (missingFunction(error)) throw new ImportDeleteError("NEEDS_MIGRATION");
      const m = /CREDITED_CARDS:(\d+)/.exec(error.message);
      if (m) throw new ImportDeleteError("CREDITED_CARDS", Number(m[1]));
      if (/NOTHING_TO_DELETE/.test(error.message)) throw new ImportDeleteError("NOTHING_TO_DELETE");
      if (/BAD_MONTH|BAD_SOURCE/.test(error.message)) throw new ImportDeleteError("BAD_REQUEST");
      throw new Error(error.message);
    }
    return {
      rowsDeleted: Number(data?.rows_deleted ?? 0),
      cardsDeleted: Number(data?.cards_deleted ?? 0),
      moneyIn: Number(data?.money_in ?? 0),
      moneyOut: Number(data?.money_out ?? 0),
    };
  }

  async listImportDeletions(limit: number): Promise<ImportDeletion[]> {
    const sb = await this.client();
    const res = await sb.from("import_deletions").select("*").order("deleted_at", { ascending: false }).limit(limit);
    if (missingTable(res.error)) return [];
    return rows(res, (r) => ({
      id: r.id,
      source: r.source,
      clinic: r.clinic ?? undefined,
      month: r.month,
      rowsDeleted: r.rows_deleted,
      cardsDeleted: r.cards_deleted,
      moneyIn: Number(r.money_in),
      moneyOut: Number(r.money_out),
      firstDate: r.first_date ?? undefined,
      lastDate: r.last_date ?? undefined,
      deletedBy: r.deleted_by,
      deletedAt: r.deleted_at,
    }));
  }

  async listImports(limit: number): Promise<ImportBatch[]> {
    const sb = await this.client();
    const res = await sb.from("import_batches").select("*").order("imported_at", { ascending: false }).limit(limit);
    return rows(res, (r) => ({
      id: r.id,
      source: r.source,
      clinic: r.clinic ?? undefined,
      fileName: r.file_name,
      firstDate: r.first_date ?? undefined,
      lastDate: r.last_date ?? undefined,
      rowsRead: r.rows_read,
      rowsAdded: r.rows_added,
      importedAt: r.imported_at,
      filePath: r.file_path ?? undefined,
    }));
  }

  async setExpenseCategory(id: string, category: string, changedBy: string) {
    const sb = await this.client();
    const { data: before, error: readErr } = await sb.from("expenses").select("category").eq("id", id).maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!before) return undefined;
    const old = before.category as string;
    if (old === category) return old;
    const { error } = await sb.from("expenses").update({ category }).eq("id", id);
    if (error) throw new Error(error.message);
    const { error: logErr } = await sb
      .from("category_changes")
      .insert({ target: "expense", target_id: id, old_value: old, new_value: category, changed_by: changedBy });
    if (logErr) {
      // No change without its history: put the old category back.
      await sb.from("expenses").update({ category: old }).eq("id", id);
      throw new Error(logErr.message);
    }
    return old;
  }

  async logCategoryChange(c: Omit<CategoryChange, "id" | "changedAt">) {
    const sb = await this.client();
    const { error } = await sb
      .from("category_changes")
      .insert({ target: c.target, target_id: c.targetId, old_value: c.oldValue, new_value: c.newValue, changed_by: c.changedBy });
    if (error) throw new Error(error.message);
  }

  async categoryChanges(target: CategoryChange["target"], ids: string[]): Promise<CategoryChange[]> {
    if (ids.length === 0) return [];
    const sb = await this.client();
    // A few ids per request keeps the query string short.
    const out: Row[] = [];
    for (let i = 0; i < ids.length; i += 100) {
      const res = await sb.from("category_changes").select("*").eq("target", target).in("target_id", ids.slice(i, i + 100));
      out.push(...rows(res, (r) => r));
    }
    return out.sort((a, b) => String(b.changed_at).localeCompare(String(a.changed_at))).map((r) => ({
      id: r.id,
      target: r.target,
      targetId: r.target_id,
      oldValue: r.old_value,
      newValue: r.new_value,
      changedBy: r.changed_by,
      changedAt: r.changed_at,
    }));
  }

  async updateBankTxn(id: string, patch: Pick<BankTxn, "kind" | "category" | "clinic" | "ruleId">) {
    const sb = await this.client();
    const { error } = await sb
      .from("bank_transactions")
      .update({ kind: patch.kind, category: patch.category ?? null, clinic: patch.clinic ?? null, rule_id: patch.ruleId ?? null })
      .eq("id", id);
    if (error) throw new Error(error.message);
  }

  async addBankRule(rule: Omit<BankRule, "id">, createdBy: string): Promise<BankRule> {
    const sb = await this.client();
    const { data, error } = await sb
      .from("bank_rules")
      .insert({
        pattern: rule.pattern,
        match_type: rule.matchType,
        action: rule.action,
        category: rule.category ?? null,
        clinic: rule.clinic ?? null,
        priority: rule.priority,
        created_by: createdBy,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return toBankRule(data);
  }

  async updateBankRule(id: string, rule: Omit<BankRule, "id">) {
    const sb = await this.client();
    const { data, error } = await sb
      .from("bank_rules")
      .update({
        pattern: rule.pattern,
        match_type: rule.matchType,
        action: rule.action,
        category: rule.category ?? null,
        clinic: rule.clinic ?? null,
        priority: rule.priority,
      })
      .eq("id", id)
      .select("id");
    if (error) throw new Error(error.message);
    if (!data?.length) throw new Error("Rule not found");
  }

  async deleteBankRule(id: string) {
    const sb = await this.client();
    const { error } = await sb.from("bank_rules").delete().eq("id", id);
    if (error) throw new Error(error.message);
  }

  async setReconNote(month: MonthKey, topic: ReconNote["topic"], note: string) {
    const sb = await this.client();
    const text = note.trim();
    const { error } = text
      ? await sb.from("recon_notes").upsert({ month, topic, note: text, updated_at: new Date().toISOString() }, { onConflict: "month,topic" })
      : await sb.from("recon_notes").delete().eq("month", month).eq("topic", topic);
    if (error) throw new Error(error.message);
  }

  async addGapReason(r: Pick<GapReason, "gapType" | "label" | "followUp">, createdBy: string): Promise<GapReason> {
    const sb = await this.client();
    const { data, error } = await sb
      .from("gap_reasons")
      .insert({ gap_type: r.gapType, label: r.label, follow_up: r.followUp, created_by: createdBy })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return toGapReason(data);
  }

  async setGapAnswer(a: Omit<GapAnswer, "answeredAt">) {
    const sb = await this.client();
    const { error } = await sb.from("gap_answers").upsert(
      {
        gap_type: a.gapType,
        item_key: a.itemKey,
        reason_id: a.reasonId,
        note: a.note,
        amount: a.amount,
        signature: a.signature ?? null,
        answered_by: a.answeredBy ?? null,
        answered_at: new Date().toISOString(),
      },
      { onConflict: "gap_type,item_key" },
    );
    if (error) throw new Error(error.message);
  }

  async addGapRule(r: Omit<GapRule, "id">, createdBy: string): Promise<GapRule> {
    const sb = await this.client();
    const { data, error } = await sb
      .from("gap_rules")
      .insert({ gap_type: r.gapType, signature: r.signature, reason_id: r.reasonId, created_by: createdBy })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return toGapRule(data);
  }

  async deleteGapRule(id: string) {
    const sb = await this.client();
    const { error } = await sb.from("gap_rules").delete().eq("id", id);
    if (error) throw new Error(error.message);
  }

  async savePettyCount(count: Omit<PettyCount, "id" | "countedAt">) {
    const sb = await this.client();
    const { data, error } = await sb
      .from("petty_cash_counts")
      .upsert(
        {
          clinic: count.clinic,
          month: count.month,
          counted: count.counted,
          reason_id: count.reasonId ?? null,
          note: count.note,
          counted_by: count.countedBy,
          counted_at: new Date().toISOString(),
        },
        { onConflict: "clinic,month" },
      )
      .select()
      .single();
    if (error) throw new Error(error.message);
    return toPettyCount(data);
  }

  async deletePettyCount(id: string) {
    const sb = await this.client();
    const { error } = await sb.from("petty_cash_counts").delete().eq("id", id);
    if (error) throw new Error(error.message);
  }

  async addPettyCountReason(label: string) {
    const sb = await this.client();
    const { data: last } = await sb.from("petty_count_reasons").select("sort_order").order("sort_order", { ascending: false }).limit(1);
    const sortOrder = Number(last?.[0]?.sort_order ?? 0) + 1;
    const { data, error } = await sb
      .from("petty_count_reasons")
      .insert({ label: label.trim().replace(/\s+/g, " "), sort_order: sortOrder })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return toPettyCountReason(data);
  }
}
