// Domain types for SDC Ledger. These mirror the tables we expect to create in
// Supabase later, so the shapes should survive the move.

export type ClinicId = "SDC1" | "SDC2";
export type ClinicOrShared = ClinicId | "SHARED";
export type PaidBy = "PETTY_CASH" | "UPI" | "BANK";
export type Role = "admin" | "staff";
export type PayeeKind = "staff" | "lab" | "pharma" | "supplier" | "consultant";
export const PAYEE_KINDS: PayeeKind[] = ["staff", "lab", "pharma", "supplier", "consultant"];
/** Is this expense already entered in PappyJoe? NA = not applicable. */
export type InPappyJoe = "YES" | "NO" | "NA";

/** A person or business an expense is paid to: a staff member (salary), a lab or a consultant. */
export interface Payee {
  id: string;
  kind: PayeeKind;
  name: string;
  active: boolean;
}

/** A month key such as "2026-10". */
export type MonthKey = string;

export interface User {
  id: string;
  name: string;
  role: Role;
  /** Home clinic for staff; used as the default on the entry form. */
  clinic?: ClinicId;
}

export interface Expense {
  id: string;
  date: string; // YYYY-MM-DD
  amount: number; // rupees
  category: string;
  clinic: ClinicOrShared;
  paidBy: PaidBy;
  /** Which clinic's petty cash box paid, when paidBy is PETTY_CASH. */
  pettyCashClinic?: ClinicId;
  note: string;
  /** Who was paid, for categories that ask (Salary, Lab, Consultant). */
  payeeId?: string;
  /** Supplier's invoice number, for categories that need one (Lab, Dental materials). */
  invoiceNo?: string;
  /** Older entries saved before this question existed have no answer. */
  inPappyJoe?: InPappyJoe;
  enteredBy: string; // user id
  enteredAt: string; // ISO timestamp
}

/** Cash withdrawn from the shared bank account into a clinic's petty cash. A transfer, not an expense. */
export interface PettyCashTransfer {
  id: string;
  date: string;
  clinic: ClinicId;
  amount: number;
  note: string;
}

/** Monthly totals per clinic, as they would come from a PappyJoe Excel export. */
export interface PappyJoeMonth {
  month: MonthKey;
  clinic: ClinicId;
  cash: number;
  upi: number;
  card: number;
}

/** A credit into the shared HDFC account, tagged to the clinic it belongs to. */
export interface BankDeposit {
  id: string;
  date: string;
  clinic: ClinicId;
  kind: "CASH" | "UPI" | "CARD";
  amount: number;
  narration: string;
}

/** Admin's explanation for a PappyJoe vs bank gap, per clinic per month. */
export interface ReconReason {
  month: MonthKey;
  clinic: ClinicId;
  reason: string;
  updatedAt: string;
}

/** A card payment in PappyJoe, collected by the doctor, that still has to reach the clinic account. */
export interface CardPayment {
  id: string;
  date: string;
  clinic: ClinicId;
  patientRef: string;
  amount: number;
  creditedOn?: string; // date it reached the clinic bank account
}

export interface LedgerData {
  users: User[];
  categories: string[];
  /** Which kind of payee each category asks for, if any. */
  categoryPayeeKind: Record<string, PayeeKind>;
  /** Categories whose expenses need an invoice number. */
  invoiceCategories: string[];
  payees: Payee[];
  expenses: Expense[];
  pettyCashTransfers: PettyCashTransfer[];
  pettyCashOpening: Record<ClinicId, number>;
  pappyJoe: PappyJoeMonth[];
  bankDeposits: BankDeposit[];
  reconReasons: ReconReason[];
  cardPayments: CardPayment[];
}

export const CLINIC_LABEL: Record<ClinicOrShared, string> = {
  SDC1: "SDC 1 · Podanur",
  SDC2: "SDC 2 · Malumichampatti",
  SHARED: "Shared",
};

export const PAID_BY_LABEL: Record<PaidBy, string> = {
  PETTY_CASH: "Petty cash",
  UPI: "UPI",
  BANK: "Bank",
};

export const PAYEE_KIND_LABEL: Record<PayeeKind, string> = {
  staff: "Staff member",
  lab: "Lab",
  pharma: "Pharmacy / supplier",
  supplier: "Dental materials supplier",
  consultant: "Consultant",
};

export const IN_PAPPYJOE_LABEL: Record<InPappyJoe, string> = {
  YES: "Yes",
  NO: "No",
  NA: "Not applicable",
};

export const CLINICS: ClinicId[] = ["SDC1", "SDC2"];
