// Data access for the prototype.
//
// Every page and action goes through the `LedgerStore` interface below, never
// the JSON file directly. When we move to Supabase, we write a
// `SupabaseLedgerStore` with the same methods and change `getStore()`.
//
// When the Supabase environment variables are set, getStore() returns the
// Supabase store (lib/data/supabase-store.ts). Otherwise it falls back to the
// MOCK store below, which keeps fake data in data/store.json on the server's
// disk, created from lib/data/seed.ts on first use.

import { promises as fs } from "fs";
import os from "os";
import path from "path";
import type {
  BankRule,
  BankTxn,
  CardPayment,
  CategoryChange,
  CategoryInfo,
  ClinicId,
  Expense,
  GapAnswer,
  GapReason,
  GapRule,
  ImportBatch,
  ImportDeletion,
  LedgerData,
  MonthKey,
  Payee,
  PayeeKind,
  PettyCount,
  PettyCountReason,
  PjReceipt,
  ReconNote,
  ReconReason,
} from "../types";
import { monthRange } from "../expense-view";
import { buildSeed } from "./seed";
import { seedGapReasons } from "../gaps";
import { SEED_PETTY_REASONS } from "../petty";
import { isSupabaseConfigured } from "../supabase/config";
import { SupabaseLedgerStore } from "./supabase-store";

/** The lists the expense form needs: a much smaller read than read(). */
export type FormOptions = Pick<LedgerData, "categories" | "categoryPayeeKind" | "invoiceCategories" | "payees">;

export interface LedgerStore {
  read(): Promise<LedgerData>;
  formOptions(): Promise<FormOptions>;
  /** Newest entries first, as far as row level security lets this user see, plus the people who entered them. */
  recentExpenses(limit: number): Promise<{ expenses: Expense[]; users: LedgerData["users"] }>;
  /**
   * Entries dated in one month (YYYY-MM), newest date first, as far as row
   * level security lets this user see. At most `limit` rows; `more` says some were left out.
   */
  monthExpenses(month: MonthKey, limit: number): Promise<{ expenses: Expense[]; users: LedgerData["users"]; more: boolean }>;
  /** Date of the oldest entry this user can see, if any. */
  firstExpenseDate(): Promise<string | undefined>;
  addExpense(e: Omit<Expense, "id" | "enteredAt">): Promise<Expense>;
  /** Admin only. Changes an expense's category and records the change (nothing when it is the same). Returns the old category, or undefined if not found. */
  setExpenseCategory(id: string, category: string, changedBy: string): Promise<string | undefined>;
  /** Admin only. Records a change made elsewhere (bank payments). */
  logCategoryChange(c: Omit<CategoryChange, "id" | "changedAt">): Promise<void>;
  /** Admin only. Changes for these items, newest first. */
  categoryChanges(target: CategoryChange["target"], ids: string[]): Promise<CategoryChange[]>;
  /** Adds a payee name, or returns the existing one with the same kind and name (any case). */
  addPayee(kind: PayeeKind, name: string, createdBy: string): Promise<Payee>;
  setPayeeActive(id: string, active: boolean): Promise<void>;

  // Categories (admin only). LedgerData.categories holds only the active ones.
  /** Every category, hidden ones too, in menu order. */
  listCategories(): Promise<CategoryInfo[]>;
  /** Adds a category at the end of the menu. The caller checks for duplicates first. */
  addCategory(name: string): Promise<void>;
  /** Renames a category; old expenses, bank payments and bank rules follow the new name. */
  renameCategory(oldName: string, newName: string): Promise<void>;
  setCategoryActive(name: string, active: boolean): Promise<void>;
  setReconReason(month: MonthKey, clinic: ClinicId, reason: string): Promise<void>;
  markCardCredited(id: string, creditedOn: string | undefined): Promise<CardPayment | undefined>;
  reset(): Promise<void>;

  // Imports (admin only).
  /** Adds bank rows; rows whose fingerprint is already stored are skipped. */
  importBank(rows: Omit<BankTxn, "id">[], meta: ImportMeta): Promise<ImportResult>;
  /** Adds PappyJoe receipts for one clinic; receipt numbers already stored are skipped. Card payments also go to card_payments. */
  importPappyJoe(clinic: ClinicId, rows: Omit<PjReceipt, "id" | "clinic">[], meta: ImportMeta): Promise<ImportResult>;
  listImports(limit: number): Promise<ImportBatch[]>;
  /** Keeps a copy of an uploaded file. Returns false when file storage is not set up yet, so the import can go ahead without it. */
  saveImportFile(path: string, data: Uint8Array, contentType: string): Promise<boolean>;
  /** Removes a kept file (used when the import of that file fails). */
  removeImportFile(path: string): Promise<void>;
  /** The original file of one import, if it was kept. */
  getImportFile(batchId: string): Promise<{ name: string; data: Uint8Array } | undefined>;
  /**
   * Deletes the imported bank rows of one month (source HDFC, no clinic), or the PappyJoe receipts of one clinic and month
   * with the card payments made from them, all or nothing, and records who did it. Throws ImportDeleteError.
   */
  deleteImportedMonth(source: ImportBatch["source"], clinic: ClinicId | undefined, month: MonthKey, deletedBy: string): Promise<MonthDeleteResult>;
  listImportDeletions(limit: number): Promise<ImportDeletion[]>;
  updateBankTxn(id: string, patch: Pick<BankTxn, "kind" | "category" | "clinic" | "ruleId">): Promise<void>;
  addBankRule(rule: Omit<BankRule, "id">, createdBy: string): Promise<BankRule>;
  updateBankRule(id: string, rule: Omit<BankRule, "id">): Promise<void>;
  deleteBankRule(id: string): Promise<void>;
  setReconNote(month: MonthKey, topic: ReconNote["topic"], note: string): Promise<void>;

  // Reconciliation answers (admin only).
  /** Adds an answer to the list for a gap type. The caller checks for duplicates first. */
  addGapReason(r: Pick<GapReason, "gapType" | "label" | "followUp">, createdBy: string): Promise<GapReason>;
  /** Saves (or replaces) the answer for one gap item. */
  setGapAnswer(a: Omit<GapAnswer, "answeredAt">): Promise<void>;
  /** Remembers an answer for every later gap with the same signature. The caller checks for duplicates first. */
  addGapRule(r: Omit<GapRule, "id">, createdBy: string): Promise<GapRule>;
  deleteGapRule(id: string): Promise<void>;

  // Month-end petty cash counts (admin only).
  /** Saves the count for its clinic and month, replacing the one already there. */
  savePettyCount(count: Omit<PettyCount, "id" | "countedAt">): Promise<PettyCount>;
  deletePettyCount(id: string): Promise<void>;
  /** Adds a reason at the end of the list. The caller checks for duplicates first. */
  addPettyCountReason(label: string, createdBy: string): Promise<PettyCountReason>;
}

export interface ImportMeta {
  fileName: string;
  importedBy: string;
  /** Where the original file was kept, if it was. */
  filePath?: string;
}

export interface MonthDeleteResult {
  rowsDeleted: number;
  cardsDeleted: number;
  moneyIn: number;
  moneyOut: number;
}

export { ImportDeleteError, inMonth } from "./store-errors";
import { ImportDeleteError, inMonth } from "./store-errors";

export interface ImportResult {
  read: number;
  added: number;
  skipped: number;
  cardsAdded?: number;
}

const span = (dates: string[]) => {
  const s = [...dates].sort();
  return { firstDate: s[0], lastDate: s[s.length - 1] };
};

// Locally the file lives in ./data. On Vercel the app folder is read-only, so
// we use the temp folder instead. That copy is per server instance and is wiped
// when Vercel recycles it, so demo entries there can reset to the seed data.
const FILE = process.env.VERCEL
  ? path.join(os.tmpdir(), "sdc-ledger", "store.json")
  : path.join(process.cwd(), "data", "store.json");
const FILES_DIR = path.join(path.dirname(FILE), "import-files");

class JsonFileStore implements LedgerStore {
  private async load(): Promise<StoredData> {
    try {
      const d = JSON.parse(await fs.readFile(FILE, "utf8")) as StoredData;
      // Files saved before payees existed: fill in the new fields from the seed.
      if (!d.payees || !d.categoryPayeeKind || !d.invoiceCategories || !d.bankRules) {
        const seed = buildSeed();
        d.payees ??= seed.payees;
        d.categoryPayeeKind ??= seed.categoryPayeeKind;
        d.invoiceCategories ??= seed.invoiceCategories;
        d.bankRules ??= seed.bankRules;
        d.bankTxns ??= [];
        d.pjReceipts ??= [];
        d.reconNotes ??= [];
        for (const c of seed.categories) if (!d.categories.includes(c)) d.categories.push(c);
      }
      d.imports ??= [];
      // Files saved before reconciliation answers existed.
      d.gapReasons ??= seedGapReasons();
      d.gapAnswers ??= [];
      d.gapRules ??= [];
      d.pettyCounts ??= [];
      d.pettyCountReasons ??= SEED_PETTY_REASONS;
      return d;
    } catch {
      const seed: StoredData = { ...buildSeed(), imports: [] };
      await this.save(seed);
      return seed;
    }
  }

  private async save(d: LedgerData) {
    await fs.mkdir(path.dirname(FILE), { recursive: true });
    await fs.writeFile(FILE, JSON.stringify(d, null, 2));
  }

  read() {
    return this.load();
  }

  async recentExpenses(limit: number) {
    const d = await this.load();
    const expenses = [...d.expenses].sort((a, b) => b.enteredAt.localeCompare(a.enteredAt)).slice(0, limit);
    return { expenses, users: d.users };
  }

  async monthExpenses(month: MonthKey, limit: number) {
    const d = await this.load();
    const { from, to } = monthRange(month);
    const all = d.expenses
      .filter((e) => e.date >= from && e.date < to)
      .sort((a, b) => b.date.localeCompare(a.date) || b.enteredAt.localeCompare(a.enteredAt));
    return { expenses: all.slice(0, limit), users: d.users, more: all.length > limit };
  }

  async firstExpenseDate() {
    const d = await this.load();
    return d.expenses.reduce<string | undefined>((min, e) => (!min || e.date < min ? e.date : min), undefined);
  }

  async formOptions() {
    const d = await this.load();
    return { categories: d.categories, categoryPayeeKind: d.categoryPayeeKind, invoiceCategories: d.invoiceCategories, payees: d.payees };
  }

  async addExpense(e: Omit<Expense, "id" | "enteredAt">) {
    const d = await this.load();
    const row: Expense = { ...e, id: `exp_${Date.now()}`, enteredAt: new Date().toISOString() };
    d.expenses.push(row);
    await this.save(d);
    return row;
  }

  async addPayee(kind: PayeeKind, name: string) {
    const d = await this.load();
    const clean = name.trim();
    const found = d.payees.find((p) => p.kind === kind && p.name.toLowerCase() === clean.toLowerCase());
    if (found) {
      if (!found.active) {
        found.active = true;
        await this.save(d);
      }
      return found;
    }
    const row: Payee = { id: `payee_${Date.now()}`, kind, name: clean, active: true };
    d.payees.push(row);
    await this.save(d);
    return row;
  }

  async setPayeeActive(id: string, active: boolean) {
    const d = await this.load();
    const p = d.payees.find((x) => x.id === id);
    if (p) {
      p.active = active;
      await this.save(d);
    }
  }

  async listCategories() {
    const d = await this.load();
    const info = (name: string, active: boolean): CategoryInfo => ({
      name,
      active,
      payeeKind: d.categoryPayeeKind[name],
      needsInvoice: d.invoiceCategories.includes(name),
    });
    return [...d.categories.map((c) => info(c, true)), ...(d.hiddenCategories ?? []).map((c) => info(c, false))];
  }

  async addCategory(name: string) {
    const d = await this.load();
    d.categories.push(name);
    await this.save(d);
  }

  async renameCategory(oldName: string, newName: string) {
    const d = await this.load();
    const swap = (c: string | undefined) => (c === oldName ? newName : c);
    d.categories = d.categories.map((c) => swap(c)!);
    d.hiddenCategories = (d.hiddenCategories ?? []).map((c) => swap(c)!);
    d.invoiceCategories = d.invoiceCategories.map((c) => swap(c)!);
    if (d.categoryPayeeKind[oldName]) {
      d.categoryPayeeKind[newName] = d.categoryPayeeKind[oldName];
      delete d.categoryPayeeKind[oldName];
    }
    for (const e of d.expenses) e.category = swap(e.category)!;
    for (const t of d.bankTxns) t.category = swap(t.category);
    for (const r of d.bankRules) r.category = swap(r.category);
    await this.save(d);
  }

  async setCategoryActive(name: string, active: boolean) {
    const d = await this.load();
    const hidden = d.hiddenCategories ?? [];
    if (active && hidden.includes(name)) {
      d.hiddenCategories = hidden.filter((c) => c !== name);
      d.categories.push(name);
    } else if (!active && d.categories.includes(name)) {
      d.categories = d.categories.filter((c) => c !== name);
      d.hiddenCategories = [...hidden, name];
    }
    await this.save(d);
  }

  async setReconReason(month: MonthKey, clinic: ClinicId, reason: string) {
    const d = await this.load();
    const rest = d.reconReasons.filter((r) => !(r.month === month && r.clinic === clinic));
    const next: ReconReason[] = reason.trim()
      ? [...rest, { month, clinic, reason: reason.trim(), updatedAt: new Date().toISOString() }]
      : rest;
    d.reconReasons = next;
    await this.save(d);
  }

  async markCardCredited(id: string, creditedOn: string | undefined) {
    const d = await this.load();
    const p = d.cardPayments.find((c) => c.id === id);
    if (p) {
      p.creditedOn = creditedOn;
      await this.save(d);
    }
    return p;
  }

  async reset() {
    await this.save(buildSeed());
  }

  private addBatch(d: StoredData, b: Omit<ImportBatch, "id" | "importedAt">) {
    d.imports.push({ ...b, id: `imp_${Date.now()}_${d.imports.length}`, importedAt: new Date().toISOString() });
  }

  async importBank(rows: Omit<BankTxn, "id">[], meta: ImportMeta) {
    const d = await this.load();
    const have = new Set(d.bankTxns.map((t) => t.fingerprint));
    const fresh = rows.filter((r) => !have.has(r.fingerprint));
    fresh.forEach((r, i) => d.bankTxns.push({ ...r, id: `txn_${Date.now()}_${i}` }));
    this.addBatch(d, { source: "HDFC", fileName: meta.fileName, filePath: meta.filePath, ...span(rows.map((r) => r.date)), rowsRead: rows.length, rowsAdded: fresh.length });
    await this.save(d);
    return { read: rows.length, added: fresh.length, skipped: rows.length - fresh.length };
  }

  async importPappyJoe(clinic: ClinicId, rows: Omit<PjReceipt, "id" | "clinic">[], meta: ImportMeta) {
    const d = await this.load();
    const have = new Set(d.pjReceipts.filter((r) => r.clinic === clinic).map((r) => r.receiptNo));
    const fresh = rows.filter((r) => !have.has(r.receiptNo));
    let cardsAdded = 0;
    fresh.forEach((r, i) => {
      const id = `pj_${Date.now()}_${i}`;
      d.pjReceipts.push({ ...r, id, clinic });
      if (r.mode === "CARD" && r.amount > 0) {
        d.cardPayments.push({
          id: `card_${id}`,
          date: r.date,
          clinic,
          patientRef: `${r.patientName} · receipt ${r.receiptNo}`,
          amount: r.amount,
          pjReceiptId: id,
        });
        cardsAdded++;
      }
    });
    this.addBatch(d, { source: "PAPPYJOE", clinic, fileName: meta.fileName, filePath: meta.filePath, ...span(rows.map((r) => r.date)), rowsRead: rows.length, rowsAdded: fresh.length });
    await this.save(d);
    return { read: rows.length, added: fresh.length, skipped: rows.length - fresh.length, cardsAdded };
  }

  async listImports(limit: number) {
    const d = await this.load();
    return [...d.imports].sort((a, b) => b.importedAt.localeCompare(a.importedAt)).slice(0, limit);
  }

  private filePathOnDisk(p: string) {
    const full = path.resolve(FILES_DIR, p);
    if (!full.startsWith(path.resolve(FILES_DIR) + path.sep)) throw new Error("bad file path");
    return full;
  }

  async saveImportFile(p: string, data: Uint8Array) {
    const full = this.filePathOnDisk(p);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, data);
    return true;
  }

  async removeImportFile(p: string) {
    await fs.rm(this.filePathOnDisk(p), { force: true });
  }

  async getImportFile(batchId: string) {
    const b = (await this.load()).imports.find((x) => x.id === batchId);
    if (!b?.filePath) return undefined;
    try {
      return { name: b.fileName, data: new Uint8Array(await fs.readFile(this.filePathOnDisk(b.filePath))) };
    } catch {
      return undefined;
    }
  }

  async deleteImportedMonth(source: ImportBatch["source"], clinic: ClinicId | undefined, month: MonthKey, deletedBy: string) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new ImportDeleteError("BAD_REQUEST");
    if (source === "HDFC" ? clinic !== undefined : clinic !== "SDC1" && clinic !== "SDC2") throw new ImportDeleteError("BAD_REQUEST");
    // One load and one save: the change is all or nothing, like the database function.
    const d = await this.load();
    let res: MonthDeleteResult;
    let dates: string[];
    if (source === "HDFC") {
      const gone = d.bankTxns.filter((t) => inMonth(t.date, month));
      if (!gone.length) throw new ImportDeleteError("NOTHING_TO_DELETE");
      d.bankTxns = d.bankTxns.filter((t) => !inMonth(t.date, month));
      dates = gone.map((t) => t.date);
      res = {
        rowsDeleted: gone.length,
        cardsDeleted: 0,
        moneyIn: round2(gone.reduce((a, t) => a + t.deposit, 0)),
        moneyOut: round2(gone.reduce((a, t) => a + t.withdrawal, 0)),
      };
    } else {
      const gone = d.pjReceipts.filter((r) => r.clinic === clinic && inMonth(r.date, month));
      const ids = new Set(gone.map((r) => r.id));
      const cards = d.cardPayments.filter((c) => c.pjReceiptId && ids.has(c.pjReceiptId));
      const credited = cards.filter((c) => c.creditedOn).length;
      if (credited) throw new ImportDeleteError("CREDITED_CARDS", credited);
      if (!gone.length) throw new ImportDeleteError("NOTHING_TO_DELETE");
      d.pjReceipts = d.pjReceipts.filter((r) => !ids.has(r.id));
      d.cardPayments = d.cardPayments.filter((c) => !(c.pjReceiptId && ids.has(c.pjReceiptId)));
      dates = gone.map((r) => r.date);
      res = {
        rowsDeleted: gone.length,
        cardsDeleted: cards.length,
        moneyIn: round2(gone.filter((r) => r.amount > 0).reduce((a, r) => a + r.amount, 0)),
        moneyOut: round2(-gone.filter((r) => r.amount < 0).reduce((a, r) => a + r.amount, 0)),
      };
    }
    const s = span(dates);
    d.importDeletions ??= [];
    d.importDeletions.push({
      id: `del_${Date.now()}_${d.importDeletions.length}`,
      source,
      clinic,
      month,
      ...res,
      firstDate: s.firstDate,
      lastDate: s.lastDate,
      deletedBy,
      deletedAt: new Date().toISOString(),
    });
    await this.save(d);
    return res;
  }

  async listImportDeletions(limit: number) {
    const d = await this.load();
    return [...(d.importDeletions ?? [])].sort((a, b) => b.deletedAt.localeCompare(a.deletedAt)).slice(0, limit);
  }

  async updateBankTxn(id: string, patch: Pick<BankTxn, "kind" | "category" | "clinic" | "ruleId">) {
    const d = await this.load();
    const t = d.bankTxns.find((x) => x.id === id);
    if (t) {
      Object.assign(t, patch);
      await this.save(d);
    }
  }

  async setExpenseCategory(id: string, category: string, changedBy: string) {
    const d = await this.load();
    const e = d.expenses.find((x) => x.id === id);
    if (!e) return undefined;
    const old = e.category;
    if (old === category) return old;
    e.category = category;
    d.categoryChanges = [...(d.categoryChanges ?? []), change({ target: "expense", targetId: id, oldValue: old, newValue: category, changedBy })];
    await this.save(d);
    return old;
  }

  async logCategoryChange(c: Omit<CategoryChange, "id" | "changedAt">) {
    const d = await this.load();
    d.categoryChanges = [...(d.categoryChanges ?? []), change(c)];
    await this.save(d);
  }

  async categoryChanges(target: CategoryChange["target"], ids: string[]) {
    const d = await this.load();
    const want = new Set(ids);
    return (d.categoryChanges ?? [])
      .filter((c) => c.target === target && want.has(c.targetId))
      .sort((a, b) => b.changedAt.localeCompare(a.changedAt));
  }

  async addBankRule(rule: Omit<BankRule, "id">) {
    const d = await this.load();
    const row: BankRule = { ...rule, id: `rule_${Date.now()}` };
    d.bankRules.push(row);
    await this.save(d);
    return row;
  }

  async updateBankRule(id: string, rule: Omit<BankRule, "id">) {
    const d = await this.load();
    const i = d.bankRules.findIndex((r) => r.id === id);
    if (i < 0) throw new Error("Rule not found");
    d.bankRules[i] = { ...rule, id };
    await this.save(d);
  }

  async deleteBankRule(id: string) {
    const d = await this.load();
    d.bankRules = d.bankRules.filter((r) => r.id !== id);
    for (const t of d.bankTxns) if (t.ruleId === id) t.ruleId = undefined;
    await this.save(d);
  }

  async setReconNote(month: MonthKey, topic: ReconNote["topic"], note: string) {
    const d = await this.load();
    d.reconNotes = d.reconNotes.filter((n) => !(n.month === month && n.topic === topic));
    if (note.trim()) d.reconNotes.push({ month, topic, note: note.trim() });
    await this.save(d);
  }

  async addGapReason(r: Pick<GapReason, "gapType" | "label" | "followUp">) {
    const d = await this.load();
    const row: GapReason = { ...r, id: `gr_${Date.now()}_${d.gapReasons.length}`, active: true };
    d.gapReasons.push(row);
    await this.save(d);
    return row;
  }

  async setGapAnswer(a: Omit<GapAnswer, "answeredAt">) {
    const d = await this.load();
    d.gapAnswers = d.gapAnswers.filter((x) => !(x.gapType === a.gapType && x.itemKey === a.itemKey));
    d.gapAnswers.push({ ...a, answeredAt: new Date().toISOString() });
    await this.save(d);
  }

  async addGapRule(r: Omit<GapRule, "id">) {
    const d = await this.load();
    const row: GapRule = { ...r, id: `gapr_${Date.now()}_${d.gapRules.length}` };
    d.gapRules.push(row);
    await this.save(d);
    return row;
  }

  async deleteGapRule(id: string) {
    const d = await this.load();
    d.gapRules = d.gapRules.filter((r) => r.id !== id);
    await this.save(d);
  }

  async savePettyCount(count: Omit<PettyCount, "id" | "countedAt">) {
    const d = await this.load();
    const old = d.pettyCounts.find((c) => c.clinic === count.clinic && c.month === count.month);
    const row: PettyCount = { ...count, id: old?.id ?? `pcount_${Date.now()}`, countedAt: new Date().toISOString() };
    d.pettyCounts = [...d.pettyCounts.filter((c) => c !== old), row];
    await this.save(d);
    return row;
  }

  async deletePettyCount(id: string) {
    const d = await this.load();
    d.pettyCounts = d.pettyCounts.filter((c) => c.id !== id);
    await this.save(d);
  }

  async addPettyCountReason(label: string) {
    const d = await this.load();
    const row: PettyCountReason = {
      id: `pcr_${Date.now()}`,
      label: label.trim().replace(/\s+/g, " "),
      active: true,
      sortOrder: Math.max(0, ...d.pettyCountReasons.map((r) => r.sortOrder)) + 1,
    };
    d.pettyCountReasons.push(row);
    await this.save(d);
    return row;
  }
}

/** The JSON file also keeps the import history and hidden categories, which are not part of LedgerData. */
type StoredData = LedgerData & {
  imports: ImportBatch[];
  hiddenCategories?: string[];
  importDeletions?: ImportDeletion[];
  categoryChanges?: CategoryChange[];
};

const round2 = (n: number) => Math.round(n * 100) / 100;

let changeSeq = 0;
const change = (c: Omit<CategoryChange, "id" | "changedAt">): CategoryChange => ({
  ...c,
  id: `chg_${Date.now()}_${changeSeq++}`,
  changedAt: new Date().toISOString(),
});

let store: LedgerStore | undefined;
export function getStore(): LedgerStore {
  store ??= isSupabaseConfigured ? new SupabaseLedgerStore() : new JsonFileStore();
  return store;
}
