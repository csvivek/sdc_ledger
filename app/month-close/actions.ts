"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { getExtras, CloseStateError } from "@/lib/data/extras";
import { getStore } from "@/lib/data/store";
import { NotSetUpError } from "@/lib/data/optional";
import { checkClose, closeChecklist, MIN_REASON } from "@/lib/month-close";
import { isMonthKey } from "@/lib/expense-view";
import { monthLabel, todayInIndia } from "@/lib/calc";
import { noteActivity } from "@/lib/note-activity";

export type CloseFormState = { ok?: string; error?: string };

const STATE_TEXT: Record<CloseStateError["code"], string> = {
  ALREADY_CLOSED: "This month is already closed.",
  NOT_CLOSED: "This month is not closed.",
  MONTH_NOT_OVER: "This month is not over yet, so it cannot be closed.",
};

export async function closeMonthAction(_prev: CloseFormState, formData: FormData): Promise<CloseFormState> {
  const user = await requireAdmin();
  const month = String(formData.get("month") ?? "");
  const force = formData.get("force") === "1";
  const note = String(formData.get("note") ?? "").trim().slice(0, 500);
  if (!isMonthKey(month)) return { error: "Pick a month." };
  try {
    const x = getExtras();
    const [d, gaps, counts] = await Promise.all([getStore().read(), x.gapAnswers(), x.pettyCounts()]);
    // The checklist is worked out again here, never taken from the browser.
    const items = closeChecklist(d, month, { gapAnswers: gaps.ready ? gaps.value : undefined, pettyCounts: counts.ready ? counts.value : undefined });
    const ok = checkClose(items, month, todayInIndia().slice(0, 7), force, note);
    if (!ok.ok) return { error: ok.error };
    await x.closeMonth(month, items, note, user.id);
    await noteActivity(user, "add", "month_closes", month, { after: { month, closed: true, note } });
  } catch (err) {
    if (err instanceof CloseStateError) return { error: STATE_TEXT[err.code] };
    if (err instanceof NotSetUpError) return { error: "Month close is not switched on yet: its SQL has not been run." };
    console.error("closeMonth failed", err);
    return { error: "Could not close the month. Please try again." };
  }
  revalidatePath("/", "layout");
  return { ok: `${monthLabel(month)} is closed. Nothing dated in it can be added or changed until it is reopened.` };
}

export async function reopenMonthAction(_prev: CloseFormState, formData: FormData): Promise<CloseFormState> {
  const user = await requireAdmin();
  const month = String(formData.get("month") ?? "");
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 500);
  if (!isMonthKey(month)) return { error: "Pick a month." };
  if (reason.length < MIN_REASON) return { error: "Say why the month is being reopened (a few words). It is kept in the history." };
  try {
    await getExtras().reopenMonth(month, reason, user.id);
    await noteActivity(user, "change", "month_closes", month, { before: { month, closed: true }, after: { closed: false, reopen_reason: reason } });
  } catch (err) {
    if (err instanceof CloseStateError) return { error: STATE_TEXT[err.code] };
    if (err instanceof NotSetUpError) return { error: "Month close is not switched on yet: its SQL has not been run." };
    console.error("reopenMonth failed", err);
    return { error: "Could not reopen the month. Please try again." };
  }
  revalidatePath("/", "layout");
  return { ok: `${monthLabel(month)} is open again. Close it again when the changes are done.` };
}
