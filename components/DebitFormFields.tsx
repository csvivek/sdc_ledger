"use client";

import { useState, useTransition, type FormEvent, type ReactNode } from "react";
import { categoriseDebit, type DebitFormState } from "@/app/import/actions";
import { useDebitNotice } from "./DebitNotices";
import { CLINIC_LABEL, type ClinicOrShared } from "@/lib/types";

/**
 * The inputs of a DebitForm. A client component so that Save shows "Saving…"
 * and cannot be pressed again while the answer is on its way, and so a failed
 * save says so instead of doing nothing.
 */
export function DebitFormFields(props: {
  id: string;
  categories: string[];
  compact: boolean;
  current: string;
  clinic: ClinicOrShared;
  pattern: string;
  head: ReactNode;
}) {
  const { id, categories, compact, current, clinic, pattern, head } = props;
  const [state, setState] = useState<DebitFormState>({});
  const [pending, startTransition] = useTransition();
  const showNotice = useDebitNotice();

  // Submit by hand rather than with <form action>, because React clears an action form
  // after it runs, and a failed save should keep what was picked. Calling the action
  // directly also lets the result reach the notice above the list.
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      let res: DebitFormState;
      try {
        res = await categoriseDebit({}, fd);
      } catch {
        res = { error: "Could not save. Check your connection and press Save again." };
      }
      // The list above this form outlives it, so a note shown there is not lost when the payment leaves the list.
      if (res.notice && showNotice) {
        showNotice(res.notice);
        res = { ...res, notice: undefined };
      }
      setState(res);
    });
  }

  return (
    <form onSubmit={submit} className={compact ? "debit-form compact" : "card debit-form"} aria-busy={pending}>
      <input type="hidden" name="id" value={id} />
      {head}
      <fieldset disabled={pending}>
        <div className="debit-fields">
          <select name="choice" defaultValue={current} required aria-label="What is this payment?">
            <option value="" disabled>What is this?</option>
            <optgroup label="Expense">
              {categories.map((c) => (
                <option key={c} value={`EXPENSE:${c}`}>{c}</option>
              ))}
            </optgroup>
            <optgroup label="Not an expense">
              <option value="PETTY_CASH">Petty cash to clinics (split equally)</option>
              <option value="TRANSFER_OUT">Other transfer (not an expense)</option>
            </optgroup>
          </select>
          <select name="clinic" defaultValue={clinic} aria-label="Which clinic">
            {(["SDC1", "SDC2", "SHARED"] as const).map((c) => (
              <option key={c} value={c}>{CLINIC_LABEL[c]}</option>
            ))}
          </select>
        </div>
        <label className="remember">
          <input type="checkbox" name="remember" value="1" defaultChecked={!compact} /> Remember: next time the narration contains
        </label>
        <div className="debit-fields">
          <input name="pattern" defaultValue={pattern} aria-label="Text to look for in future narrations" />
          <button type="submit" className="small">{pending ? "Saving…" : "Save"}</button>
        </div>
      </fieldset>
      {state.error && !pending && <p className="err" role="alert">{state.error}</p>}
      {state.notice && !pending && <p className="notice" role="status">{state.notice}</p>}
      {state.saved && !state.notice && !pending && compact && <p className="ok">Saved.</p>}
    </form>
  );
}
