// The activity log: who added, changed or deleted what, and when.
// On Supabase the rows are written by database triggers (see the staff and
// activity migration); in fake-data mode the app's actions write them.
// This file turns a row into a sentence. Pure functions, no I/O.

import { CLINIC_LABEL } from "./types";

export type ActivityAction = "add" | "change" | "delete";

export interface ActivityEntry {
  id: string;
  at: string;
  /** Empty when the change was made in the Supabase SQL editor, not the app. */
  actorId?: string;
  actorName?: string;
  action: ActivityAction;
  /** The table name, e.g. "expenses". */
  entity: string;
  entityId?: string;
  /** add: undefined. change: the changed fields before. delete: the old row. */
  before?: Record<string, unknown>;
  /** add: the new row. change: the changed fields after. delete: undefined. */
  after?: Record<string, unknown>;
}

export interface ActivityFilter {
  actorId?: string;
  entity?: string;
  /** YYYY-MM-DD, inclusive, in India time. */
  from?: string;
  to?: string;
  /** Show entries older than this id (for "Older"). */
  before?: string;
  limit: number;
}

export const ENTITY_LABEL: Record<string, string> = {
  expenses: "Expense",
  categories: "Category",
  payees: "Payee",
  bank_rules: "Bank rule",
  import_batches: "Import",
  bank_transactions: "Bank payment",
  profiles: "Login",
  card_payments: "Card payment",
  petty_cash_transfers: "Petty cash transfer",
  recon_notes: "Reconcile note",
  recon_reasons: "Reconcile reason",
  clinics: "Clinic",
  gap_reasons: "Gap answer choice",
  gap_answers: "Gap answer",
  gap_rules: "Remembered gap answer",
  petty_count_reasons: "Petty count reason",
  petty_cash_counts: "Petty cash count",
  import_deletions: "Deleted import month",
  category_changes: "Category change",
  month_closes: "Month close",
  recurring_templates: "Recurring expense",
};

export const ACTION_LABEL: Record<ActivityAction, string> = { add: "Added", change: "Changed", delete: "Deleted" };

/** Field names as people read them. */
const FIELD_LABEL: Record<string, string> = {
  amount: "amount",
  category: "category",
  clinic: "clinic",
  date: "date",
  txn_date: "date",
  paid_by: "paid by",
  note: "note",
  name: "name",
  active: "on/off",
  role: "role",
  kind: "type",
  pattern: "text",
  action: "action",
  credited_on: "credited on",
  payee_id: "payee",
  invoice_no: "invoice no.",
  status: "status",
  reason: "reason",
  day_of_month: "day of month",
};

const IGNORED = new Set(["id", "created_at", "updated_at", "entered_at", "entered_by", "created_by", "fingerprint", "batch_id", "rule_id"]);

const money = (v: unknown) => (typeof v === "number" || (typeof v === "string" && v !== "" && !isNaN(Number(v))) ? "₹" + Number(v).toLocaleString("en-IN") : String(v ?? ""));

function show(field: string, v: unknown): string {
  if (v === null || v === undefined || v === "") return "empty";
  if (field === "amount" || field === "withdrawal" || field === "deposit") return money(v);
  if (field === "clinic" && typeof v === "string" && v in CLINIC_LABEL) return v;
  if (typeof v === "boolean") return field === "active" ? (v ? "on" : "off") : v ? "yes" : "no";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** The few facts that say which row it is: amount, category, name, file... */
function identify(entity: string, r: Record<string, unknown> | undefined): string {
  if (!r) return "";
  const g = (k: string) => (r[k] === undefined || r[k] === null || r[k] === "" ? undefined : r[k]);
  // Rows can be database rows (snake_case) or fake-data objects (camelCase).
  const pick = (...ks: string[]) => ks.map(g).find((v) => v !== undefined);
  switch (entity) {
    case "expenses":
      return [pick("amount") !== undefined ? money(pick("amount")) : "", pick("category"), pick("clinic"), pick("date")].filter(Boolean).join(" · ");
    case "bank_transactions":
      return [pick("narration"), pick("txn_date", "date"), pick("withdrawal") ? money(pick("withdrawal")) : ""].filter(Boolean).join(" · ");
    case "bank_rules":
      return String(pick("pattern") ?? "");
    case "import_batches":
      return [pick("file_name", "fileName"), pick("source"), pick("clinic"), pick("rows_added", "rowsAdded") !== undefined ? `${pick("rows_added", "rowsAdded")} rows added` : ""].filter(Boolean).join(" · ");
    case "month_closes":
      return String(pick("month") ?? "");
    case "recurring_templates":
      return [pick("label", "name"), pick("amount") !== undefined ? money(pick("amount")) : ""].filter(Boolean).join(" · ");
    case "card_payments":
      return [pick("patient_ref", "patientRef"), pick("amount") !== undefined ? money(pick("amount")) : ""].filter(Boolean).join(" · ");
    default:
      return String(pick("name", "label", "month", "pattern", "file_name", "item_key") ?? "");
  }
}

/** One readable line for an entry, e.g. "₹1,200 · Flowers · SDC1 · 2026-10-03" or "category: Flowers → Pharma". */
export function describeActivity(e: ActivityEntry): string {
  if (e.action === "add") return identify(e.entity, e.after);
  if (e.action === "delete") return identify(e.entity, e.before);
  const before = e.before ?? {};
  const after = e.after ?? {};
  const changes = Object.keys(after)
    .filter((k) => !IGNORED.has(k) && JSON.stringify(before[k]) !== JSON.stringify(after[k]))
    .map((k) => `${FIELD_LABEL[k] ?? k.replace(/_/g, " ")}: ${show(k, before[k])} → ${show(k, after[k])}`);
  const which = identify(e.entity, { ...before, ...after });
  return [which, changes.join("; ")].filter(Boolean).join(" — ");
}

/** Who did it, as the log page shows it. */
export function actorLabel(e: ActivityEntry): string {
  if (e.actorName) return e.actorName;
  if (!e.actorId) return "Database (SQL editor)";
  return "Someone no longer listed";
}

/** Fields of an updated object that really changed, for the fake-data log. */
export function changedFields(before: Record<string, unknown>, after: Record<string, unknown>) {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)]))
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) {
      b[k] = before[k];
      a[k] = after[k];
    }
  return { before: b, after: a };
}
