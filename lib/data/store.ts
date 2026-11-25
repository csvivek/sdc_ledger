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
import type { CardPayment, ClinicId, Expense, LedgerData, MonthKey, ReconReason } from "../types";
import { buildSeed } from "./seed";
import { isSupabaseConfigured } from "../supabase/config";
import { SupabaseLedgerStore } from "./supabase-store";

export interface LedgerStore {
  read(): Promise<LedgerData>;
  addExpense(e: Omit<Expense, "id" | "enteredAt">): Promise<Expense>;
  setReconReason(month: MonthKey, clinic: ClinicId, reason: string): Promise<void>;
  markCardCredited(id: string, creditedOn: string | undefined): Promise<CardPayment | undefined>;
  reset(): Promise<void>;
}

// Locally the file lives in ./data. On Vercel the app folder is read-only, so
// we use the temp folder instead. That copy is per server instance and is wiped
// when Vercel recycles it, so demo entries there can reset to the seed data.
const FILE = process.env.VERCEL
  ? path.join(os.tmpdir(), "sdc-ledger", "store.json")
  : path.join(process.cwd(), "data", "store.json");

class JsonFileStore implements LedgerStore {
  private async load(): Promise<LedgerData> {
    try {
      return JSON.parse(await fs.readFile(FILE, "utf8")) as LedgerData;
    } catch {
      const seed = buildSeed();
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

  async addExpense(e: Omit<Expense, "id" | "enteredAt">) {
    const d = await this.load();
    const row: Expense = { ...e, id: `exp_${Date.now()}`, enteredAt: new Date().toISOString() };
    d.expenses.push(row);
    await this.save(d);
    return row;
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
}

let store: LedgerStore | undefined;
export function getStore(): LedgerStore {
  store ??= isSupabaseConfigured ? new SupabaseLedgerStore() : new JsonFileStore();
  return store;
}
