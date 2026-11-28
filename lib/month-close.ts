// Month close: the checklist the admin goes through before closing a month,
// and the rules for what a closed month blocks. Pure functions, no I/O.
//
// Once a month is closed, nothing dated in it can be added, changed or
// deleted: expenses, imported bank and PappyJoe rows, petty cash, notes and
// answers. The admin can reopen it with a reason, which is recorded. On
// Supabase the database itself enforces this (triggers), so it holds even for
// pages added later; the app checks first to give a clear message.

import { gapRows, monthsBetween } from "./accountant-export";
import { monthLabel, monthOf } from "./calc";
import { shiftMonth } from "./expense-view";
import { matches, reconcileMonth } from "./recon";
import { collectGaps, gapStates } from "./gaps";
import type { GapAnswerInfo, PettyCountInfo } from "./admin-types";
import { CLINIC_LABEL, CLINICS, type LedgerData, type MonthKey } from "./types";

export type CheckStatus = "done" | "todo" | "warn" | "na";

export interface CheckItem {
  key: string;
  label: string;
  status: CheckStatus;
  detail: string;
  /** Where to fix it. */
  href?: string;
}

export interface MonthClose {
  month: MonthKey;
  closed: boolean;
  closedBy?: string;
  closedByName?: string;
  closedAt?: string;
  note: string;
  /** The checklist as it stood when the month was closed. */
  checklist: CheckItem[];
  reopenedByName?: string;
  reopenedAt?: string;
  reopenReason?: string;
}

export interface CloseEvent {
  id: string;
  month: MonthKey;
  action: "close" | "reopen";
  reason: string;
  byName?: string;
  at: string;
}

/** A statement or export that stops this many days or fewer before the month end counts as covering the month. */
export const END_SLACK_DAYS = 3;

export const lastDay = (m: MonthKey) => {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
};

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

/** Whether dated rows cover a month: something in it, and either something later or the last row near the month end. */
function coverage(dates: string[], month: MonthKey): { status: CheckStatus; last?: string } {
  const inMonth = dates.filter((x) => monthOf(x) === month).sort();
  if (!inMonth.length) return { status: "todo" };
  const last = inMonth[inMonth.length - 1];
  const later = dates.some((x) => monthOf(x) > month);
  return { status: later || daysBetween(last, lastDay(month)) <= END_SLACK_DAYS ? "done" : "todo", last };
}

const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");

export interface ChecklistExtras {
  /** Present once PR #15's gap answer tables exist. */
  gapAnswers?: GapAnswerInfo[];
  /** Present once PR #16's petty cash count table exists. */
  pettyCounts?: PettyCountInfo[];
}

export function closeChecklist(d: LedgerData, month: MonthKey, x: ChecklistExtras = {}): CheckItem[] {
  const items: CheckItem[] = [];
  const bank = coverage(d.bankTxns.map((t) => t.date), month);
  items.push({
    key: "bank",
    label: "HDFC statement imported for the whole month",
    status: bank.status,
    detail:
      bank.status === "done"
        ? `Bank rows up to ${bank.last}.`
        : bank.last
          ? `The statement stops on ${bank.last}. Import the rest of the month.`
          : `No bank rows for ${monthLabel(month)} yet.`,
    href: "/import",
  });

  for (const c of CLINICS) {
    const typed = d.pappyJoe.some((p) => p.month === month && p.clinic === c);
    const pj = coverage(d.pjReceipts.filter((r) => r.clinic === c).map((r) => r.date), month);
    const status = typed && pj.status === "todo" && !pj.last ? "done" : pj.status;
    items.push({
      key: `pj-${c}`,
      label: `PappyJoe payments imported: ${CLINIC_LABEL[c]}`,
      status,
      detail:
        status === "done"
          ? pj.last
            ? `Payments up to ${pj.last}.`
            : "Monthly totals were typed in."
          : pj.last
            ? `The export stops on ${pj.last}. Import the rest of the month.`
            : `No PappyJoe payments for this clinic in ${monthLabel(month)} yet.`,
      href: "/import",
    });
  }

  const m = matches(d);
  const r = reconcileMonth(d, month, m);
  const unknown = r.expenses.unknown.length;
  items.push({
    key: "categorised",
    label: "Every bank payment has a category",
    status: unknown ? "todo" : "done",
    detail: unknown ? `${unknown} bank payment(s) still need a category.` : "All bank payments are sorted.",
    href: "/import",
  });

  const o = { from: month, to: month, scope: "ALL" as const };
  if (x.gapAnswers) {
    // The same list and answers as the Reconcile page (answered by hand or by a remembered rule).
    const states = gapStates(d, collectGaps(d, r));
    const open = states.filter((g) => g.status === "open").length;
    items.push({
      key: "gaps",
      label: "Every reconciliation gap has a reason",
      status: open ? "todo" : "done",
      detail: open ? `${open} of ${states.length} gap(s) have no reason yet.` : states.length ? `All ${states.length} gap(s) have a reason.` : "No gaps this month.",
      href: `/reconciliation?month=${month}`,
    });
  } else {
    const rows = gapRows(d, o, undefined, true).filter((g) => g.type !== "Bank payment without a category");
    items.push({
      key: "gaps",
      label: "Every reconciliation gap has a reason",
      status: "na",
      detail: `Answering each gap is not switched on yet (needs the reconciliation answers SQL, PR #15). This month has ${rows.length} gap(s); notes typed on Reconcile are kept.`,
      href: `/reconciliation?month=${month}`,
    });
  }

  if (x.pettyCounts) {
    const missing = CLINICS.filter((c) => !x.pettyCounts!.some((p) => p.clinic === c && p.month === month));
    items.push({
      key: "petty",
      label: "Petty cash counted at both clinics",
      status: missing.length ? "todo" : "done",
      detail: missing.length ? `Not counted yet: ${missing.map((c) => CLINIC_LABEL[c]).join(", ")}.` : "Both clinics counted.",
      href: `/petty-cash?month=${month}`,
    });
  } else {
    items.push({
      key: "petty",
      label: "Petty cash counted at both clinics",
      status: "na",
      detail: "Month-end counts are not switched on yet (needs the petty cash count SQL, PR #16).",
      href: "/petty-cash",
    });
  }

  const pendingCards = d.cardPayments.filter((c) => monthOf(c.date) === month && !c.creditedOn && !m.cardCredit.has(c.id));
  const pendingAmt = pendingCards.reduce((s, c) => s + c.amount, 0);
  items.push({
    key: "cards",
    label: "Card income from this month is in the bank",
    status: pendingCards.length ? "warn" : "done",
    detail: pendingCards.length
      ? `${inr(pendingAmt)} (${pendingCards.length} payment(s)) is still with the doctor. This does not stop the close: card payments can still be marked credited later.`
      : "Nothing pending.",
    href: "/card-income",
  });
  return items;
}

/** Items that must be done before a normal close. "warn" and "na" never block. */
export const blockers = (items: CheckItem[]) => items.filter((i) => i.status === "todo");

/** A month can be closed once it is over (in India time). */
export function canCloseMonth(month: MonthKey, currentMonth: MonthKey): boolean {
  return month < currentMonth;
}

export const MIN_REASON = 5;

export type CloseCheck = { ok: true; forced: boolean } | { ok: false; error: string };

/** Whether this close is allowed: all done, or "close anyway" with a reason. */
export function checkClose(items: CheckItem[], month: MonthKey, currentMonth: MonthKey, force: boolean, note: string): CloseCheck {
  if (!canCloseMonth(month, currentMonth)) return { ok: false, error: `${monthLabel(month)} is not over yet, so it cannot be closed.` };
  const open = blockers(items);
  if (!open.length) return { ok: true, forced: false };
  if (!force) return { ok: false, error: `${open.length} item(s) are not done yet. Finish them, or close anyway with a reason.` };
  if (note.trim().length < MIN_REASON) return { ok: false, error: "Say why you are closing with items not done (a few words)." };
  return { ok: true, forced: true };
}

/** The months the close page offers: every month with data, up to last month. */
export function closableMonths(months: MonthKey[], currentMonth: MonthKey): MonthKey[] {
  const past = months.filter((m) => m < currentMonth);
  const last = shiftMonth(currentMonth, -1);
  return [...new Set([...past, last])].sort();
}

/** Months in a list of dates that are closed. */
export function closedIn(dates: string[], closed: Set<MonthKey>): MonthKey[] {
  return [...new Set(dates.map(monthOf))].filter((m) => closed.has(m)).sort();
}

export const closedMessage = (m: MonthKey) => `${monthLabel(m)} is closed, so nothing dated in it can be added or changed. The admin can reopen it on Month close.`;

/** Recognises the database's refusal for a closed month. */
export function closedMonthFromError(err: unknown): MonthKey | undefined {
  const msg = String((err as Error)?.message ?? err);
  return msg.match(/MONTH_CLOSED:(\d{4}-\d{2})/)?.[1];
}

export { monthsBetween };
