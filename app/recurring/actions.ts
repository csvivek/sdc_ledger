"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { getStore } from "@/lib/data/store";
import { DuplicateLabelError, getExtras } from "@/lib/data/extras";
import { NotSetUpError } from "@/lib/data/optional";
import { closedError, closedMonths } from "@/lib/closed-months";
import { closedMessage, closedMonthFromError } from "@/lib/month-close";
import { isMonthKey } from "@/lib/expense-view";
import { inr, monthLabel } from "@/lib/calc";
import { noteActivity } from "@/lib/note-activity";
import { checkTemplate, dateFor, expenseFrom, isDuplicateRecurring, monthItems, toAddAll, type RecurringTemplate } from "@/lib/recurring";
import type { MonthKey } from "@/lib/types";

export type RecurringState = { ok?: string; error?: string };

const NOT_ON = "Recurring expenses are not switched on yet: the SQL for them has not been run.";

export async function saveTemplateAction(_prev: RecurringState, formData: FormData): Promise<RecurringState> {
  const user = await requireAdmin();
  const id = String(formData.get("id") ?? "") || undefined;
  const raw = Object.fromEntries([...formData.entries()].map(([k, v]) => [k, String(v)]));
  try {
    const x = getExtras();
    const [opts, list] = await Promise.all([getStore().formOptions(), x.listTemplates()]);
    if (!list.ready) return { error: NOT_ON };
    const before = id ? list.value.find((t) => t.id === id) : undefined;
    if (id && !before) return { error: "That recurring expense no longer exists. Reload the page." };
    const checked = checkTemplate(raw, opts, list.value, id);
    if (typeof checked === "string") return { error: checked };
    const saved = await x.saveTemplate(checked, id);
    await noteActivity(user, id ? "change" : "add", "recurring_templates", saved.id, id ? { before, after: saved } : { after: saved });
    revalidatePath("/recurring");
    return { ok: id ? `Saved changes to “${saved.label}”.` : `Added “${saved.label}”. It now shows in every month below.` };
  } catch (err) {
    if (err instanceof DuplicateLabelError) return { error: "A recurring expense with this name is already in the list." };
    if (err instanceof NotSetUpError) return { error: NOT_ON };
    console.error("saveTemplate failed", err);
    return { error: "Could not save. Please try again." };
  }
}

export async function toggleTemplateAction(formData: FormData) {
  const user = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const active = formData.get("active") === "1";
  try {
    await getExtras().setTemplateActive(id, active);
    await noteActivity(user, "change", "recurring_templates", id, { before: { active: !active }, after: { active } });
  } catch (err) {
    console.error("toggleTemplate failed", err);
  }
  revalidatePath("/recurring");
}

/** Loads what a month needs: the templates, and the month's expenses. */
async function monthState(month: MonthKey) {
  const list = await getExtras().listTemplates();
  if (!list.ready) return undefined;
  const d = await getStore().read();
  return { templates: list.value, items: monthItems(list.value, month, d.expenses) };
}

/** Saves one, mapping the database's "already added" and "month closed" refusals to plain words. */
async function saveOne(t: RecurringTemplate, month: MonthKey, amount: number, date: string, userId: string): Promise<"added" | "dup" | string> {
  try {
    const saved = await getStore().addExpense(expenseFrom(t, month, amount, date, userId));
    await noteActivity({ id: userId }, "add", "expenses", saved.id, { after: saved });
    return "added";
  } catch (err) {
    if (isDuplicateRecurring(err)) return "dup";
    const m = closedMonthFromError(err);
    if (m) return closedMessage(m);
    console.error("addRecurring failed", err);
    return "Could not save. Please try again.";
  }
}

export async function addRecurringAction(_prev: RecurringState, formData: FormData): Promise<RecurringState> {
  const user = await requireAdmin();
  const month = String(formData.get("month") ?? "");
  const id = String(formData.get("id") ?? "");
  const amount = Math.round(Number(formData.get("amount")) * 100) / 100;
  const date = String(formData.get("date") ?? "");
  if (!isMonthKey(month)) return { error: "Pick a month." };
  if (!(amount > 0) || amount > 10000000) return { error: "Enter the amount paid." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date.slice(0, 7) !== month) return { error: `Pick a date in ${monthLabel(month)}.` };
  const closed = await closedError(date);
  if (closed) return { error: closed };
  try {
    const s = await monthState(month);
    if (!s) return { error: NOT_ON };
    const item = s.items.find((i) => i.template.id === id);
    if (!item) return { error: "That recurring expense is not in the list any more. Reload the page." };
    if (item.added) return { error: `“${item.template.label}” is already added for ${monthLabel(month)} (${inr(item.added.amount)} on ${item.added.date}).` };
    const r = await saveOne(item.template, month, amount, date, user.id);
    if (r === "dup") return { error: `“${item.template.label}” is already added for ${monthLabel(month)}.` };
    if (r !== "added") return { error: r };
    revalidatePath("/", "layout");
    return { ok: `Added ${item.template.label}: ${inr(amount)} on ${date}.` };
  } catch (err) {
    if (err instanceof NotSetUpError) return { error: NOT_ON };
    console.error("addRecurring failed", err);
    return { error: "Could not save. Please try again." };
  }
}

/** Adds every one not added yet, at its usual amount and day. Skips the ones that look typed by hand already. */
export async function addAllRecurringAction(_prev: RecurringState, formData: FormData): Promise<RecurringState> {
  const user = await requireAdmin();
  const month = String(formData.get("month") ?? "");
  if (!isMonthKey(month)) return { error: "Pick a month." };
  if ((await closedMonths()).has(month)) return { error: closedMessage(month) };
  try {
    const s = await monthState(month);
    if (!s) return { error: NOT_ON };
    const todo = toAddAll(s.items);
    if (!todo.length) return { ok: `Nothing to add: everything for ${monthLabel(month)} is already added or looks entered by hand.` };
    let added = 0;
    let total = 0;
    let dup = 0;
    for (const i of todo) {
      const r = await saveOne(i.template, month, i.template.amount, dateFor(i.template, month), user.id);
      if (r === "added") {
        added++;
        total += i.template.amount;
      } else if (r === "dup") dup++;
      else {
        revalidatePath("/", "layout");
        return { error: `${added ? `Added ${added}, then stopped: ` : ""}${r}` };
      }
    }
    const skipped = s.items.filter((i) => !i.added && i.lookalike).length;
    revalidatePath("/", "layout");
    return {
      ok: [
        `Added ${added} for ${monthLabel(month)}, ${inr(total)} in all.`,
        dup ? `${dup} had just been added by someone else.` : "",
        skipped ? `${skipped} skipped because a matching entry was already typed by hand.` : "",
      ]
        .filter(Boolean)
        .join(" "),
    };
  } catch (err) {
    if (err instanceof NotSetUpError) return { error: NOT_ON };
    console.error("addAllRecurring failed", err);
    return { error: "Could not save. Please try again." };
  }
}
