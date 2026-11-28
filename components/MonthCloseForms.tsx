"use client";

import { useActionState, useState } from "react";
import { closeMonthAction, reopenMonthAction, type CloseFormState } from "@/app/month-close/actions";

function Feedback({ s }: { s: CloseFormState }) {
  return (
    <div aria-live="polite">
      {s.ok && <p className="ok">✓ {s.ok}</p>}
      {s.error && <p className="err">{s.error}</p>}
    </div>
  );
}

export function CloseForm({ month, label, blockers }: { month: string; label: string; blockers: number }) {
  const [state, action, pending] = useActionState<CloseFormState, FormData>(closeMonthAction, {});
  const [anyway, setAnyway] = useState(false);
  return (
    <form action={action} className="card form-card">
      <input type="hidden" name="month" value={month} />
      {blockers === 0 ? (
        <>
          <p>Everything needed is done. Closing stops anyone adding, changing or deleting anything dated in {label}.</p>
          <label htmlFor="close-note">Note (optional)</label>
          <input id="close-note" name="note" maxLength={500} autoComplete="off" placeholder="e.g. Checked with the accountant" />
        </>
      ) : (
        <>
          <p>
            {blockers} item{blockers === 1 ? " is" : "s are"} not done yet. It is best to finish {blockers === 1 ? "it" : "them"} first.
          </p>
          <label className="check">
            <input type="checkbox" name="force" value="1" checked={anyway} onChange={(e) => setAnyway(e.target.checked)} /> Close anyway
          </label>
          {anyway && (
            <>
              <label htmlFor="close-note">Why close with items not done?</label>
              <input id="close-note" name="note" required minLength={5} maxLength={500} autoComplete="off" placeholder="e.g. PappyJoe export for the last 2 days comes next week" />
            </>
          )}
        </>
      )}
      <button type="submit" className="full" disabled={pending || (blockers > 0 && !anyway)}>
        {pending ? "Closing…" : `Close ${label}`}
      </button>
      <Feedback s={state} />
    </form>
  );
}

export function ReopenForm({ month, label }: { month: string; label: string }) {
  const [state, action, pending] = useActionState<CloseFormState, FormData>(reopenMonthAction, {});
  return (
    <form action={action} className="card form-card">
      <input type="hidden" name="month" value={month} />
      <label htmlFor="reopen-reason">Reopen {label}: why?</label>
      <input id="reopen-reason" name="reason" required minLength={5} maxLength={500} autoComplete="off" placeholder="e.g. A lab bill was missed" />
      <p className="muted">The reason is kept in the history below. Close the month again when the change is made.</p>
      <button type="submit" className="secondary full" disabled={pending}>{pending ? "Reopening…" : `Reopen ${label}`}</button>
      <Feedback s={state} />
    </form>
  );
}
