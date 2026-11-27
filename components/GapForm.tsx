"use client";

import { useState, useTransition, type FormEvent } from "react";
import { saveGapAnswer, type GapFormState } from "@/app/reconciliation/actions";
import { useDebitNotice } from "./DebitNotices";
import type { GapReason, GapType } from "@/lib/types";

/**
 * "What happened?" for one gap: the answers for this kind of gap as a list to
 * pick from, the suggested one already picked, and "Something else" to type a
 * new answer, which is offered next time too.
 */
export function GapForm(props: {
  month: string;
  gapType: GapType;
  itemKey: string;
  question: string;
  reasons: GapReason[];
  selected?: string;
  suggested?: { reasonId: string; why: string };
  note?: string;
  signatureLabel?: string;
}) {
  const { month, gapType, itemKey, question, reasons, selected, suggested, note, signatureLabel } = props;
  const [choice, setChoice] = useState(selected ?? suggested?.reasonId ?? "");
  const [state, setState] = useState<GapFormState>({});
  const [pending, startTransition] = useTransition();
  const showNotice = useDebitNotice();
  const name = `reason-${gapType}-${itemKey}`;

  // Called by hand, not as <form action>, so a failed save keeps what was picked.
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const fd = new FormData(e.currentTarget);
    fd.set("reasonId", choice);
    startTransition(async () => {
      let res: GapFormState;
      try {
        res = await saveGapAnswer({}, fd);
      } catch {
        res = { error: "Could not save. Check your connection and press Save again." };
      }
      // An answered item leaves this list, so the note is shown above the list instead.
      if (res.notice && showNotice) {
        showNotice(res.notice);
        res = { ...res, notice: undefined };
      }
      setState(res);
    });
  }

  return (
    <form onSubmit={submit} className="gap-form" aria-busy={pending}>
      <input type="hidden" name="month" value={month} />
      <input type="hidden" name="gapType" value={gapType} />
      <input type="hidden" name="itemKey" value={itemKey} />
      <fieldset disabled={pending}>
        <legend>{question}</legend>
        <div className="reason-list" role="radiogroup">
          {reasons.map((r) => (
            <label key={r.id} className={choice === r.id ? "picked" : ""}>
              <input type="radio" name={name} value={r.id} checked={choice === r.id} onChange={() => setChoice(r.id)} />
              <span>
                <span className="reason-label">
                  {r.label}
                  {suggested?.reasonId === r.id && <span className="tag">Suggested</span>}
                </span>
                <span className="reason-next">{r.followUp ? `To do: ${r.todo ?? "fix it, then it matches on the next import."}` : "Nothing to fix"}</span>
              </span>
            </label>
          ))}
          <label className={choice === "NEW" ? "picked" : ""}>
            <input type="radio" name={name} value="NEW" checked={choice === "NEW"} onChange={() => setChoice("NEW")} />
            <span>
              <span className="reason-label">Something else…</span>
              <span className="reason-next">Type it. It is added to this list for next time.</span>
            </span>
          </label>
        </div>
        {choice === "NEW" && (
          <div className="gap-new">
            <input name="newLabel" maxLength={120} placeholder="What happened?" aria-label="What happened" required autoFocus />
            <label className="remember">
              <input type="checkbox" name="newFollowUp" value="1" /> Something still needs fixing
            </label>
          </div>
        )}
        {suggested && choice === suggested.reasonId && !selected && <p className="muted gap-why">Suggested {suggested.why}.</p>}
        <input name="note" defaultValue={note} maxLength={500} placeholder="Note for this item (optional)" aria-label="Note" />
        {signatureLabel && (
          <label className="remember">
            <input type="checkbox" name="remember" value="1" /> Use this answer automatically for {signatureLabel}
          </label>
        )}
        <button type="submit" className="small" disabled={!choice}>{pending ? "Saving…" : "Save answer"}</button>
      </fieldset>
      {state.error && !pending && <p className="err" role="alert">{state.error}</p>}
      {state.notice && !pending && <p className="notice" role="status">{state.notice}</p>}
      {state.saved && !state.notice && !pending && <p className="ok">Saved.</p>}
    </form>
  );
}
