"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { getStore } from "@/lib/data/store";
import { reconcileMonth } from "@/lib/recon";
import { collectGaps, gapStates, normaliseReason } from "@/lib/gaps";
import { closedMonths } from "@/lib/closed-months";
import { closedMessage, closedMonthFromError } from "@/lib/month-close";
import { GAP_TYPES, type GapReason, type GapType } from "@/lib/types";

export type GapFormState = { error?: string; saved?: boolean; notice?: string };

const SAVE_FAILED = "Could not save. Check your connection and press Save again.";

/**
 * The admin answers one gap: picks an answer from the list, or types a new one
 * (added to the list for next time; the same text twice is declined softly and
 * the existing answer is used). Optionally remembers it for the same sender,
 * patient or payee, so later gaps like it are answered without asking.
 */
export async function saveGapAnswer(_prev: GapFormState, formData: FormData): Promise<GapFormState> {
  const user = await requireAdmin();
  const month = String(formData.get("month") ?? "");
  const gapType = String(formData.get("gapType") ?? "") as GapType;
  const itemKey = String(formData.get("itemKey") ?? "");
  const choice = String(formData.get("reasonId") ?? "");
  const newLabel = String(formData.get("newLabel") ?? "").trim().replace(/\s+/g, " ");
  const newFollowUp = formData.get("newFollowUp") === "1";
  const note = String(formData.get("note") ?? "").trim().slice(0, 500);
  const remember = formData.get("remember") === "1";

  if (!/^\d{4}-\d{2}$/.test(month) || !GAP_TYPES.includes(gapType) || !itemKey) return { error: "Reload the page and try again." };
  if (!choice) return { error: "Pick what happened, or choose Something else and type it." };
  if ((await closedMonths()).has(month)) return { error: closedMessage(month) };

  const notices: string[] = [];
  try {
    const store = getStore();
    const d = await store.read();
    const item = collectGaps(d, reconcileMonth(d, month)).find((x) => x.type === gapType && x.key === itemKey);
    if (!item) return { error: "This item is no longer a gap (a newer import may have matched it). Reload the page." };

    let reason: GapReason | undefined;
    if (choice === "NEW") {
      if (newLabel.length < 3 || newLabel.length > 120) return { error: "Type what happened in 3 to 120 characters." };
      const same = d.gapReasons.find((r) => r.gapType === gapType && normaliseReason(r.label) === normaliseReason(newLabel));
      if (same && same.active) {
        reason = same;
        notices.push(`"${same.label}" is already an answer, so that one was used instead of adding it again.`);
      } else if (same) {
        return { error: `"${same.label}" was an answer that has been hidden. Pick another or type different words.` };
      } else {
        try {
          reason = await store.addGapReason({ gapType, label: newLabel, followUp: newFollowUp }, user.id);
        } catch (err) {
          // The database also refuses the same text (two saves at once, for example).
          if (!/gap_reasons_label_unique|duplicate key/i.test(String((err as Error)?.message))) throw err;
          const again = (await store.read()).gapReasons.find((r) => r.gapType === gapType && normaliseReason(r.label) === normaliseReason(newLabel));
          if (!again) throw err;
          reason = again;
          notices.push(`"${again.label}" is already an answer, so that one was used.`);
        }
      }
    } else {
      reason = d.gapReasons.find((r) => r.id === choice && r.gapType === gapType && r.active);
      if (!reason) return { error: "That answer is no longer offered. Reload the page and pick again." };
    }

    await store.setGapAnswer({
      gapType,
      itemKey,
      reasonId: reason.id,
      note,
      amount: item.amount,
      signature: item.signature,
      answeredBy: user.id,
    });

    if (remember && item.signature) {
      const existing = d.gapRules.find((r) => r.gapType === gapType && r.signature === item.signature);
      if (existing) {
        const label = d.gapReasons.find((r) => r.id === existing.reasonId)?.label ?? "another answer";
        notices.push(
          existing.reasonId === reason.id
            ? `Saved. This is already remembered for ${item.signatureLabel}.`
            : `Saved this one. ${item.signatureLabel} is already remembered as "${label}", so that was not changed. Forget it under Remembered answers first if it is wrong.`,
        );
      } else {
        try {
          const rule = await store.addGapRule({ gapType, signature: item.signature, reasonId: reason.id }, user.id);
          d.gapRules.push(rule);
          // Other open items of the same kind this month are now answered by the rule.
          const others = gapStates(d, collectGaps(d, reconcileMonth(d, month))).filter(
            (s) => s.status === "auto" && s.rule?.id === rule.id && s.item.key !== itemKey,
          ).length;
          if (others) notices.push(`Remembered. ${others} more item(s) for ${item.signatureLabel} this month were answered the same way.`);
        } catch (err) {
          if (!/duplicate key|gap_rules_gap_type_signature_key/i.test(String((err as Error)?.message))) throw err;
          notices.push(`Saved. ${item.signatureLabel} is already remembered.`);
        }
      }
    }
  } catch (err) {
    const m = closedMonthFromError(err);
    if (m) return { error: closedMessage(m) };
    console.error("saveGapAnswer failed", gapType, itemKey, err);
    return { error: SAVE_FAILED };
  }
  revalidatePath("/reconciliation");
  return { saved: true, notice: notices.join(" ") || undefined };
}

export async function forgetGapRule(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await getStore().deleteGapRule(id);
  revalidatePath("/reconciliation");
}
