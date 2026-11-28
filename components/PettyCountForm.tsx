"use client";

import { startTransition, useActionState, useEffect, useState, type FormEvent } from "react";
import { deletePettyCount, savePettyCount, type CountFormState } from "@/app/petty-cash/actions";
import { differs, OTHER_REASON } from "@/lib/petty";
import type { ClinicId, PettyCountReason } from "@/lib/types";

const inr = (n: number) => "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

export interface SavedCount {
  id: string;
  counted: number;
  reasonId?: string;
  note: string;
  countedAt: string;
  countedByName: string;
}

/** The month-end count for one clinic and month: shows the saved count, or a form to enter or edit it. Admin only (the actions check). */
export function PettyCountForm({
  clinic,
  month,
  expected,
  reasons,
  saved,
}: {
  clinic: ClinicId;
  month: string;
  expected: number;
  reasons: PettyCountReason[];
  saved?: SavedCount;
}) {
  const [state, save, saving] = useActionState<CountFormState, FormData>(savePettyCount, {});
  const [delState, remove, removing] = useActionState<CountFormState, FormData>(deletePettyCount, {});
  const [editing, setEditing] = useState(!saved);
  const [amount, setAmount] = useState(saved ? String(saved.counted) : "");
  const [reason, setReason] = useState(saved?.reasonId ?? "");
  const busy = saving || removing;

  // After a save or removal, show the saved state again (or an empty form).
  useEffect(() => {
    if (state.savedAt) setEditing(false);
  }, [state.savedAt]);
  useEffect(() => {
    if (delState.savedAt) {
      setEditing(true);
      setAmount("");
      setReason("");
    }
  }, [delState.savedAt]);

  const typed = Number(amount.replace(/[₹,\s]/g, ""));
  const hasAmount = amount.trim() !== "" && Number.isFinite(typed);
  const difference = hasAmount ? typed - expected : 0;
  const needsReason = hasAmount && differs(difference);
  // A reason that was hidden later still shows on the count that used it.
  const shown = saved?.reasonId && !reasons.some((r) => r.id === saved.reasonId) ? reasons : reasons.filter((r) => r.active);

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const fd = new FormData(e.currentTarget, submitter);
    startTransition(() => (submitter?.value === "delete" ? remove(fd) : save(fd)));
  }

  const message = (s: CountFormState) =>
    s.error ? <p className="err" role="alert">{s.error}</p> : s.notice ? <p className="notice" role="status">{s.notice}</p> : s.ok ? <p className="ok" role="status">{s.ok}</p> : null;

  if (saved && !editing) {
    const savedDiff = saved.counted - expected;
    const reasonLabel = reasons.find((r) => r.id === saved.reasonId)?.label;
    return (
      <form onSubmit={submit} className="count-form">
        <input type="hidden" name="id" value={saved.id} />
        <div className="count-line">
          <span>Counted in the box</span>
          <strong>{inr(saved.counted)}</strong>
        </div>
        <div className="count-line">
          <span>Difference</span>
          <strong className={differs(savedDiff) ? "neg" : "pos"}>
            {differs(savedDiff) ? `${savedDiff > 0 ? "+" : "−"}${inr(Math.abs(savedDiff))}` : "None"}
          </strong>
        </div>
        {differs(savedDiff) && (
          <p className="muted">Why: {reasonLabel ?? (saved.reasonId ? "(reason removed)" : "not answered yet; edit the count to pick one")}</p>
        )}
        {saved.note && <p className="muted">Note: {saved.note}</p>}
        <p className="muted">
          Counted by {saved.countedByName} on{" "}
          {new Date(saved.countedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" })}
        </p>
        <div className="rule-buttons">
          <button type="button" className="secondary" onClick={() => setEditing(true)} disabled={busy}>
            Edit count
          </button>
          <button type="submit" value="delete" className="secondary" disabled={busy}>
            {removing ? "Removing…" : "Remove count"}
          </button>
        </div>
        {message(state.savedAt ? state : delState)}
      </form>
    );
  }

  return (
    <form onSubmit={submit} className="count-form">
      <input type="hidden" name="clinic" value={clinic} />
      <input type="hidden" name="month" value={month} />
      {saved && <input type="hidden" name="id" value={saved.id} />}
      <label htmlFor={`counted-${clinic}`}>Cash counted in the box</label>
      <div className="amount-input">
        <span aria-hidden="true">₹</span>
        <input
          id={`counted-${clinic}`}
          name="counted"
          inputMode="decimal"
          autoComplete="off"
          placeholder="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
        />
      </div>
      <p className="muted">
        Expected {inr(expected)}.{" "}
        {hasAmount &&
          (needsReason ? (
            <strong className="neg">
              {inr(Math.abs(difference))} {difference > 0 ? "more" : "less"} than expected.
            </strong>
          ) : (
            <strong className="pos">Matches.</strong>
          ))}
      </p>
      {needsReason && (
        <>
          <label htmlFor={`reason-${clinic}`}>Why is it different?</label>
          <select id={`reason-${clinic}`} name="reason" value={reason} onChange={(e) => setReason(e.target.value)} required>
            <option value="">Pick a reason</option>
            {shown.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
            <option value={OTHER_REASON}>Something else…</option>
          </select>
          {reason === OTHER_REASON && (
            <input name="otherReason" aria-label="Type the reason" placeholder="Type the reason" minLength={3} maxLength={120} required autoComplete="off" />
          )}
        </>
      )}
      <label htmlFor={`note-${clinic}`}>Note (optional)</label>
      <input id={`note-${clinic}`} name="note" maxLength={500} defaultValue={saved?.note ?? ""} autoComplete="off" />
      <div className="rule-buttons">
        <button type="submit"  disabled={busy}>
          {saving ? "Saving…" : saved ? "Save changes" : "Save count"}
        </button>
        {saved && (
          <button type="button" className="secondary" onClick={() => setEditing(false)} disabled={busy}>
            Cancel
          </button>
        )}
      </div>
      {message(state.savedAt ? delState : state)}
    </form>
  );
}
