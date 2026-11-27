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
  CategoryInfo,
  ClinicId,
  Expense,
  ImportBatch,
  LedgerData,
  MonthKey,
  Payee,
  PayeeKind,
  PjReceipt,
  ReconNote,
  ReconReason,
} from "../types";
import { buildSeed } from "./seed";
import { isSupabaseConfigured } from "../supabase/config";
import { SupabaseLedgerStore } from "./supabase-store";

/** The lists the expense form needs: a much smaller read than read(). */
export type FormOptions = Pick<LedgerData, "categories" | "categoryPayeeKind" | "invoiceCategories" | "payees">;

export interface LedgerStore {
  read(): Promise<LedgerData>;
  formOptions(): Promise<FormOptions>;
  /** Newest entries first, as far as row level security lets this user see, plus the people who entered them. */
  recentExpenses(limit: number): Promise<{ expenses: Expense[]; users: LedgerData["users"] }>;
  addExpense(e: Omit<Expense, "id" | "enteredAt">): Promise<Expense>;
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
  updateBankTxn(id: string, patch: Pick<BankTxn, "kind" | "category" | "clinic" | "ruleId">): Promise<void>;
  addBankRule(rule: Omit<BankRule, "id">, createdBy: string): Promise<BankRule>;
  deleteBankRule(id: string): Promise<void>;
  setReconNote(month: MonthKey, topic: ReconNote["topic"], note: string): Promise<void>;
}

export interface ImportMeta {
  fileName: string;
  importedBy: string;
}

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
    this.addBatch(d, { source: "HDFC", fileName: meta.fileName, ...span(rows.map((r) => r.date)), rowsRead: rows.length, rowsAdded: fresh.length });
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
        d.cardPayments.push({ id: `card_${id}`, date: r.date, clinic, patientRef: `${r.patientName} · receipt ${r.receiptNo}`, amount: r.amount });
        cardsAdded++;
      }
    });
    this.addBatch(d, { source: "PAPPYJOE", clinic, fileName: meta.fileName, ...span(rows.map((r) => r.date)), rowsRead: rows.length, rowsAdded: fresh.length });
    await this.save(d);
    return { read: rows.length, added: fresh.length, skipped: rows.length - fresh.length, cardsAdded };
  }

  async listImports(limit: number) {
    const d = await this.load();
    return [...d.imports].sort((a, b) => b.importedAt.localeCompare(a.importedAt)).slice(0, limit);
  }

  async updateBankTxn(id: string, patch: Pick<BankTxn, "kind" | "category" | "clinic" | "ruleId">) {
    const d = await this.load();
    const t = d.bankTxns.find((x) => x.id === id);
    if (t) {
      Object.assign(t, patch);
      await this.save(d);
    }
  }

  async addBankRule(rule: Omit<BankRule, "id">) {
    const d = await this.load();
    const row: BankRule = { ...rule, id: `rule_${Date.now()}` };
    d.bankRules.push(row);
    await this.save(d);
    return row;
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
}

/** The JSON file also keeps the import history and hidden categories, which are not part of LedgerData. */
type StoredData = LedgerData & { imports: ImportBatch[]; hiddenCategories?: string[] };

let store: LedgerStore | undefined;
export function getStore(): LedgerStore {
  store ??= isSupabaseConfigured ? new SupabaseLedgerStore() : new JsonFileStore();
  return store;
}
