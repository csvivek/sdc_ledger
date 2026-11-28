// Domain types for SDC Ledger. These mirror the tables we expect to create in
// Supabase later, so the shapes should survive the move.

export type ClinicId = "SDC1" | "SDC2";
export type ClinicOrShared = ClinicId | "SHARED";
export type PaidBy = "PETTY_CASH" | "UPI" | "BANK";
export type Role = "admin" | "staff";
export type PayeeKind = "staff" | "lab" | "pharma" | "supplier" | "consultant" | "landlord";
export const PAYEE_KINDS: PayeeKind[] = ["staff", "lab", "pharma", "supplier", "consultant", "landlord"];
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
  /** Set when the payment came from a PappyJoe import; empty when entered by hand. */
  pjReceiptId?: string;
}

/** How a bank row was understood. Credits: UPI_IN, CASH_DEPOSIT, OTHER_IN. Debits: the rest. */
export type BankTxnKind = "UPI_IN" | "CASH_DEPOSIT" | "OTHER_IN" | "EXPENSE" | "PETTY_CASH" | "TRANSFER_OUT" | "UNKNOWN_OUT";

export const BANK_KIND_LABEL: Record<BankTxnKind, string> = {
  UPI_IN: "UPI received",
  CASH_DEPOSIT: "Cash deposit",
  OTHER_IN: "Other credit",
  EXPENSE: "Expense",
  PETTY_CASH: "Petty cash to clinics",
  TRANSFER_OUT: "Transfer (not an expense)",
  UNKNOWN_OUT: "Needs a category",
};

/** One row of the HDFC statement, as imported. */
export interface BankTxn {
  id: string;
  date: string; // YYYY-MM-DD
  narration: string;
  refNo: string;
  valueDate: string;
  withdrawal: number;
  deposit: number;
  balance: number;
  kind: BankTxnKind;
  category?: string;
  clinic?: ClinicOrShared;
  /** The rule that categorised it automatically; empty when the admin chose by hand. */
  ruleId?: string;
  /** Stops the same row being imported twice. */
  fingerprint: string;
}

/** What a bank rule does to a matching debit. */
export type RuleAction = "EXPENSE" | "PETTY_CASH" | "TRANSFER_OUT";

/** "If the narration matches this, it is that." Seeded from the October sample; the admin's answers add more. */
export interface BankRule {
  id: string;
  pattern: string;
  matchType: "contains" | "regex";
  action: RuleAction;
  category?: string;
  clinic?: ClinicOrShared;
  priority: number;
}

export type PayMode = "CASH" | "UPI" | "CARD" | "OTHER";

/** One payment line from the PappyJoe "Payments" export. */
export interface PjReceipt {
  id: string;
  clinic: ClinicId;
  date: string;
  patientName: string;
  patientId: string;
  receiptNo: string;
  invoiceNo: string;
  invoiceTotal: number;
  /** Negative values are reversals or corrections in PappyJoe. */
  amount: number;
  mode: PayMode;
  paymentInfo: string;
  receiptBy: string;
}

export interface ImportBatch {
  id: string;
  source: "HDFC" | "PAPPYJOE";
  clinic?: ClinicId;
  fileName: string;
  firstDate?: string;
  lastDate?: string;
  rowsRead: number;
  rowsAdded: number;
  importedAt: string;
  /** Where the original uploaded file is kept (private storage); empty for imports made before files were kept. */
  filePath?: string;
}

/** One "delete imported data for a month", kept as a record of who removed what. */
export interface ImportDeletion {
  id: string;
  source: "HDFC" | "PAPPYJOE";
  clinic?: ClinicId;
  month: MonthKey;
  rowsDeleted: number;
  cardsDeleted: number;
  moneyIn: number;
  moneyOut: number;
  firstDate?: string;
  lastDate?: string;
  deletedBy: string;
  deletedAt: string;
}

/** Admin's explanation for one part of a month's reconciliation. */
export interface ReconNote {
  month: MonthKey;
  topic: "UPI" | "CASH" | "CARD" | "EXPENSES";
  note: string;
}

/** One expense category as the admin's Categories page shows it. */
export interface CategoryInfo {
  name: string;
  /** Hidden categories stay on old entries and in reports but are no longer offered. */
  active: boolean;
  payeeKind?: PayeeKind;
  needsInvoice: boolean;
}

/**
 * A gap the reconciliation found, one item at a time: a bank UPI credit with no
 * PappyJoe receipt, a PappyJoe UPI receipt with no bank credit, money received
 * that is not UPI or cash, a portal expense not found in the bank, a negative
 * PappyJoe line, or a month's cash that does not match its deposits.
 */
export type GapType = "UPI_BANK_ONLY" | "UPI_PJ_ONLY" | "OTHER_CREDIT" | "PORTAL_ONLY" | "PJ_NEGATIVE" | "CASH_GAP";
export const GAP_TYPES: GapType[] = ["UPI_BANK_ONLY", "UPI_PJ_ONLY", "OTHER_CREDIT", "PORTAL_ONLY", "PJ_NEGATIVE", "CASH_GAP"];

/** One answer the admin can pick for a gap. Built-in ones have a code; the admin's own have none. */
export interface GapReason {
  id: string;
  gapType: GapType;
  label: string;
  /** True when something still has to be fixed, for example in PappyJoe. */
  followUp: boolean;
  /** What to do next, shown with a follow-up answer. */
  todo?: string;
  code?: string;
  active: boolean;
}

/** The admin's answer for one gap item. */
export interface GapAnswer {
  gapType: GapType;
  /** The bank row, PappyJoe receipt or expense id; for a cash gap, the month. */
  itemKey: string;
  reasonId: string;
  note: string;
  /** The gap's amount when answered. If it changes later (a cash gap), the item is asked again. */
  amount: number;
  /** What makes items "the same kind", such as who sent the money. Used to suggest and remember. */
  signature?: string;
  answeredBy?: string;
  answeredAt: string;
}

/** "Always answer gaps like this one with that reason": the reconciliation's version of a bank rule. */
export interface GapRule {
  id: string;
  gapType: GapType;
  signature: string;
  reasonId: string;
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
  bankTxns: BankTxn[];
  bankRules: BankRule[];
  pjReceipts: PjReceipt[];
  reconNotes: ReconNote[];
  gapReasons: GapReason[];
  gapAnswers: GapAnswer[];
  gapRules: GapRule[];
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
  landlord: "Landlord / other vendor",
};

export const IN_PAPPYJOE_LABEL: Record<InPappyJoe, string> = {
  YES: "Yes",
  NO: "No",
  NA: "Not applicable",
};

export const CLINICS: ClinicId[] = ["SDC1", "SDC2"];
