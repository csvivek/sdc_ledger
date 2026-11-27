"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { getStore } from "@/lib/data/store";
import { inr, pettyCashMonth, todayInIndia } from "@/lib/calc";
import { differs, findReasonByLabel, OTHER_REASON } from "@/lib/petty";
import { CLINIC_LABEL, type ClinicId } from "@/lib/types";

export type CountFormState = { ok?: string; notice?: string; error?: string; savedAt?: number };

const MAX_COUNT = 1_000_000;

function readAmount(raw: string): number | string {
  const text = raw.replace(/[₹,\s]/g, "");
  if (!text) return "Type the cash you counted in the box.";
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return "Type the amount in rupees, like 2450 or 2450.50.";
  const n = Number(text);
  if (n > MAX_COUNT) return `That is more than ${inr(MAX_COUNT)}. Please check the amount.`;
  return n;
}

/**
 * Saves the cash counted in one clinic's petty cash box at the end of a month.
 * When it differs from what the app expected, a reason is needed: one from the
 * list, or typed under "Something else…" (added to the list, or matched to the
 * same text already there). A second count for the same clinic and month is
 * declined unless it is an edit of the one already saved.
 */
export async function savePettyCount(_prev: CountFormState, formData: FormData): Promise<CountFormState> {
  const user = await requireAdmin();
  const clinic = String(formData.get("clinic") ?? "") as ClinicId;
  const month = String(formData.get("month") ?? "");
  const editingId = String(formData.get("id") ?? "");
  if (clinic !== "SDC1" && clinic !== "SDC2") return { error: "Pick a clinic." };
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return { error: "Pick a month." };
  if (month > todayInIndia().slice(0, 7)) return { error: "That month has not started yet." };
  const counted = readAmount(String(formData.get("counted") ?? ""));
  if (typeof counted === "string") return { error: counted };
  const note = String(formData.get("note") ?? "").trim().slice(0, 500);

  try {
    const store = getStore();
    const d = await store.read();
    const existing = d.pettyCounts.find((c) => c.clinic === clinic && c.month === month);
    if (existing && existing.id !== editingId) {
      return {
        notice: `Not saved: ${CLINIC_LABEL[clinic]} was already counted for this month (${inr(existing.counted)}). Reload the page and edit that count instead.`,
      };
    }
    if (!existing && editingId) return { error: "This count was removed. Reload the page." };

    const p = pettyCashMonth(d, clinic, month);
    const difference = counted - p.expected;
    let reasonId: string | undefined;
    const notes: string[] = [];
    if (differs(difference)) {
      const choice = String(formData.get("reason") ?? "");
      if (!choice) return { error: `The count is ${inr(Math.abs(difference))} ${difference > 0 ? "more" : "less"} than expected. Pick why.` };
      if (choice === OTHER_REASON) {
        const label = String(formData.get("otherReason") ?? "").trim().replace(/\s+/g, " ");
        if (label.length < 3 || label.length > 120) return { error: "Type the reason in 3 to 120 characters." };
        const same = findReasonByLabel(d.pettyCountReasons, label);
        if (same) {
          reasonId = same.id;
          notes.push(`"${same.label}" was already in the list, so that one was used.`);
        } else {
          reasonId = (await store.addPettyCountReason(label, user.id)).id;
          notes.push("Your reason was added to the list for next time.");
        }
      } else {
        if (!d.pettyCountReasons.some((r) => r.id === choice)) return { error: "Pick a reason from the list." };
        reasonId = choice;
      }
    }

    await store.savePettyCount({ clinic, month, counted, reasonId, note, countedBy: user.id });
    revalidatePath("/petty-cash");
    revalidatePath("/reconciliation");
    const head = differs(difference)
      ? `Count saved. ${inr(Math.abs(difference))} ${difference > 0 ? "more" : "less"} than expected; next month starts with ${inr(counted)}.`
      : `Count saved. It matches; next month starts with ${inr(counted)}.`;
    return { ok: [head, ...notes].join(" "), savedAt: Date.now() };
  } catch (err) {
    // Two saves racing: the database allows one count per clinic and month.
    if (/duplicate key|petty_cash_counts_clinic_month/i.test(String((err as Error)?.message ?? err)))
      return { notice: "Not saved: this month was just counted. Reload the page and edit that count." };
    if (/duplicate key|petty_count_reasons_label_unique/i.test(String((err as Error)?.message ?? err)))
      return { notice: "That reason was just added. Reload the page and pick it from the list." };
    console.error("save petty count failed", err);
    return { error: "Could not save the count. Please try again." };
  }
}

export async function deletePettyCount(_prev: CountFormState, formData: FormData): Promise<CountFormState> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  try {
    const store = getStore();
    const d = await store.read();
    if (!d.pettyCounts.some((c) => c.id === id)) return { error: "This count was already removed. Reload the page." };
    await store.deletePettyCount(id);
    revalidatePath("/petty-cash");
    revalidatePath("/reconciliation");
    return { ok: "Count removed. The month now ends on the expected balance.", savedAt: Date.now() };
  } catch (err) {
    console.error("delete petty count failed", err);
    return { error: "Could not remove the count. Please try again." };
  }
}
