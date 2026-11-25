// LedgerStore backed by Supabase. Every call runs as the logged-in user, so
// row level security decides what comes back: admin gets everything, staff
// get categories, clinics, their own profile and their own expenses.

import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "../supabase/server";
import type {
  BankDeposit,
  CardPayment,
  ClinicId,
  Expense,
  LedgerData,
  MonthKey,
  PappyJoeMonth,
  Payee,
  PayeeKind,
  PettyCashTransfer,
  ReconReason,
  User,
} from "../types";
import type { LedgerStore } from "./store";

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
  labInvoiceNo: r.lab_invoice_no ?? undefined,
  inPappyJoe: r.in_pappyjoe ?? undefined,
  enteredBy: r.entered_by,
  enteredAt: r.entered_at,
});

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

export class SupabaseLedgerStore implements LedgerStore {
  constructor(private client: () => Promise<SupabaseClient> = createClient) {}

  async read(): Promise<LedgerData> {
    const sb = await this.client();
    const [profiles, clinics, categories, payees, expenses, transfers, pj, deposits, reasons, cards] = await Promise.all([
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
      })),
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
        lab_invoice_no: e.labInvoiceNo ?? null,
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
}
