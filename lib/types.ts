// Domain types for SDC Ledger. These mirror the tables we expect to create in
// Supabase later, so the shapes should survive the move.

export type ClinicId = "SDC1" | "SDC2";
export type ClinicOrShared = ClinicId | "SHARED";
export type PaidBy = "PETTY_CASH" | "UPI" | "BANK";
export type Role = "admin" | "staff";

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

export const CLINICS: ClinicId[] = ["SDC1", "SDC2"];
