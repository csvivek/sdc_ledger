// One-tap recurring expenses: the admin's list of monthly costs (rent,
// salaries, EB...) and, for a month, which of them are already added.
// Pure functions, no I/O.
//
// An expense added from a template is an ordinary expense that also remembers
// the template and month, so it can never be added twice for the same month,
// and it matches the bank debit through the normal reconciliation (same
// amount within 7 days of the date).

import type { FormOptions } from "./data/store";
import { lastDay } from "./month-close";
import { CLINIC_LABEL, type ClinicId, type ClinicOrShared, type Expense, type MonthKey, type PaidBy, type Payee } from "./types";

export interface RecurringTemplate {
  id: string;
  label: string;
  category: string;
  payeeId?: string;
  clinic: ClinicOrShared;
  paidBy: PaidBy;
  pettyCashClinic?: ClinicId;
  amount: number;
  /** Usual day of the month it is paid. In shorter months the last day is used. */
  dayOfMonth: number;
  note: string;
  active: boolean;
  sortOrder: number;
}

export type TemplateInput = Omit<RecurringTemplate, "id" | "active" | "sortOrder">;

/** The date a template falls on in a month (31st becomes 30th or 28th in short months). */
export function dateFor(t: Pick<RecurringTemplate, "dayOfMonth">, month: MonthKey): string {
  const last = Number(lastDay(month).slice(8, 10));
  return `${month}-${String(Math.min(t.dayOfMonth, last)).padStart(2, "0")}`;
}

const sameLabel = (a: string, b: string) => a.trim().replace(/\s+/g, " ").toLowerCase() === b.trim().replace(/\s+/g, " ").toLowerCase();

/** Checks a template against the current categories and payees. Returns an error message, or the cleaned template. */
export function checkTemplate(
  raw: Record<string, string>,
  opts: FormOptions,
  existing: RecurringTemplate[],
  editingId?: string,
): TemplateInput | string {
  const label = (raw.label ?? "").trim().replace(/\s+/g, " ");
  const category = raw.category ?? "";
  const clinic = raw.clinic as ClinicOrShared;
  const paidBy = raw.paidBy as PaidBy;
  const amount = Number(raw.amount);
  const dayOfMonth = Number(raw.dayOfMonth);
  const note = (raw.note ?? "").trim();
  if (label.length < 2 || label.length > 80) return "Give it a short name, such as \"Rent SDC 1\".";
  const dup = existing.find((t) => t.id !== editingId && sameLabel(t.label, label));
  if (dup) return `"${dup.label}" is already in the list${dup.active ? "" : " (hidden)"}. Edit that one instead.`;
  if (!opts.categories.includes(category)) return "Pick a category.";
  if (opts.invoiceCategories.includes(category))
    return `${category} needs a new invoice number every time, so enter it on Add expense instead.`;
  if (!["SDC1", "SDC2", "SHARED"].includes(clinic)) return "Pick a clinic.";
  if (!["PETTY_CASH", "UPI", "BANK"].includes(paidBy)) return "Pick how it is paid.";
  if (!(amount > 0) || amount > 10000000) return "Enter the usual amount.";
  if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) return "Day of the month must be 1 to 31.";
  if (note.length > 200) return "Please keep the note under 200 letters.";
  const kind = opts.categoryPayeeKind[category];
  let payeeId: string | undefined;
  if (kind) {
    const p = opts.payees.find((x) => x.id === raw.payeeId && x.kind === kind && x.active);
    if (!p) return "Pick who is paid.";
    payeeId = p.id;
  }
  let pettyCashClinic: ClinicId | undefined;
  if (paidBy === "PETTY_CASH") {
    pettyCashClinic = (clinic === "SHARED" ? raw.pettyCashClinic : clinic) as ClinicId;
    if (pettyCashClinic !== "SDC1" && pettyCashClinic !== "SDC2") return "Pick which clinic's petty cash pays it.";
  }
  return { label, category, payeeId, clinic, paidBy, pettyCashClinic, amount: Math.round(amount * 100) / 100, dayOfMonth, note };
}

export interface MonthItem {
  template: RecurringTemplate;
  date: string;
  /** The expense already added from this template for the month. */
  added?: Expense;
  /** An expense typed by hand that looks like this one (same category, clinic, payee and amount). Add all skips it. */
  lookalike?: Expense;
}

/** For each active template (and any hidden one already used this month), where it stands in `month`. */
export function monthItems(templates: RecurringTemplate[], month: MonthKey, monthExpenses: Expense[]): MonthItem[] {
  const inMonth = monthExpenses.filter((e) => e.date.slice(0, 7) === month);
  return templates
    .filter((t) => t.active || inMonth.some((e) => e.recurringId === t.id && e.recurringMonth === month))
    .sort((a, b) => a.dayOfMonth - b.dayOfMonth || a.sortOrder - b.sortOrder || a.label.localeCompare(b.label))
    .map((t) => {
      const added = monthExpenses.find((e) => e.recurringId === t.id && e.recurringMonth === month);
      const lookalike = added
        ? undefined
        : inMonth.find(
            (e) => !e.recurringId && e.category === t.category && e.clinic === t.clinic && (e.payeeId ?? "") === (t.payeeId ?? "") && Math.abs(e.amount - t.amount) < 0.005,
          );
      return { template: t, date: dateFor(t, month), added, lookalike };
    });
}

/** What Add all would add: not yet added, and not looking like a hand-typed entry. */
export const toAddAll = (items: MonthItem[]) => items.filter((i) => !i.added && !i.lookalike && i.template.active);

export function describeTemplate(t: RecurringTemplate, payees: Payee[]): string {
  const payee = t.payeeId ? payees.find((p) => p.id === t.payeeId)?.name : undefined;
  const how = t.paidBy === "PETTY_CASH" ? `petty cash ${t.pettyCashClinic ?? ""}`.trim() : t.paidBy === "UPI" ? "UPI" : "bank";
  return [t.category, payee, CLINIC_LABEL[t.clinic].split(" · ")[0], `by ${how}`, `day ${t.dayOfMonth}`].filter(Boolean).join(" · ");
}

/** The expense to save for a template in a month, with the amount (and date) as confirmed on the screen. */
export function expenseFrom(t: RecurringTemplate, month: MonthKey, amount: number, date: string, enteredBy: string): Omit<Expense, "id" | "enteredAt"> {
  return {
    date,
    amount,
    category: t.category,
    clinic: t.clinic,
    paidBy: t.paidBy,
    pettyCashClinic: t.paidBy === "PETTY_CASH" ? t.pettyCashClinic : undefined,
    note: t.note ? `${t.label} · ${t.note}` : t.label,
    payeeId: t.payeeId,
    inPappyJoe: "NA",
    enteredBy,
    recurringId: t.id,
    recurringMonth: month,
  };
}

export const isDuplicateRecurring = (err: unknown) => /expenses_recurring_once|duplicate key/i.test(String((err as Error)?.message ?? err));
