// Books: the five steps of a month's books (Import, Reconcile, Petty cash,
// Card income, Close) and whether each is done, from the month close checklist.

import { closeChecklist, type ChecklistExtras, type CheckItem } from "./month-close";
import type { LedgerData, MonthKey } from "./types";

export type StepState = "done" | "todo" | "na";

export interface BooksStep {
  href: string;
  label: string;
  state: StepState;
  /** Short note shown beside a step that is not done, such as "2 to answer". */
  hint: string;
  /** The checklist lines behind this step that are not done. */
  open: CheckItem[];
}

const KEYS: Record<string, (k: string) => boolean> = {
  "/import": (k) => k === "bank" || k.startsWith("pj-"),
  "/reconciliation": (k) => k === "categorised" || k === "gaps",
  "/petty-cash": (k) => k === "petty",
  "/card-income": (k) => k === "cards",
};

function stateOf(items: CheckItem[]): StepState {
  if (items.length && items.every((i) => i.status === "na")) return "na";
  return items.some((i) => i.status === "todo" || i.status === "warn") ? "todo" : "done";
}

function hintOf(href: string, items: CheckItem[]): string {
  const open = items.filter((i) => i.status === "todo" || i.status === "warn");
  if (!open.length) return "";
  if (href === "/import") return `${open.length} missing`;
  if (href === "/petty-cash") return "not counted";
  if (href === "/card-income") return "pending";
  // Reconcile: count the answers still needed.
  const nums = open.map((i) => Number(/(\d+)/.exec(i.detail)?.[1] ?? 0)).reduce((s, n) => s + n, 0);
  return nums ? `${nums} to answer` : "to do";
}

export function booksSteps(d: LedgerData, month: MonthKey, extras: ChecklistExtras, closed: boolean): BooksStep[] {
  const items = closeChecklist(d, month, extras);
  const steps: BooksStep[] = (
    [
      ["/import", "Import"],
      ["/reconciliation", "Reconcile"],
      ["/petty-cash", "Petty cash"],
      ["/card-income", "Card income"],
    ] as const
  ).map(([href, label]) => {
    const mine = items.filter((i) => KEYS[href](i.key));
    return {
      href,
      label,
      state: stateOf(mine),
      hint: hintOf(href, mine),
      open: mine.filter((i) => i.status === "todo" || i.status === "warn"),
    };
  });
  steps.push({ href: "/month-close", label: "Close", state: closed ? "done" : "todo", hint: "", open: [] });
  return steps;
}
