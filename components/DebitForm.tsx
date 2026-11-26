import { categoriseDebit } from "@/app/import/actions";
import { counterparty, suggestPattern } from "@/lib/import/hdfc";
import { inr } from "@/lib/calc";
import { CLINIC_LABEL, type BankTxn } from "@/lib/types";

/** One bank debit with a small form to say what it is. Used for the "needs your answer" list and to correct a guess. */
export function DebitForm({ txn, categories, compact = false }: { txn: BankTxn; categories: string[]; compact?: boolean }) {
  const cp = counterparty(txn.narration);
  const current = txn.kind === "EXPENSE" ? `EXPENSE:${txn.category}` : txn.kind === "UNKNOWN_OUT" ? "" : txn.kind;
  return (
    <form action={categoriseDebit} className={compact ? "debit-form compact" : "card debit-form"}>
      <input type="hidden" name="id" value={txn.id} />
      {!compact && (
        <div className="debit-head">
          <strong>{inr(txn.withdrawal)}</strong> <span className="muted">{txn.date}</span>
          <div className="narration">{txn.narration}</div>
          {cp.name !== txn.narration && (
            <div className="muted">
              To {cp.name}
              {cp.remark ? ` · "${cp.remark}"` : ""}
            </div>
          )}
        </div>
      )}
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
        <select name="clinic" defaultValue={txn.clinic ?? "SHARED"} aria-label="Which clinic">
          {(["SDC1", "SDC2", "SHARED"] as const).map((c) => (
            <option key={c} value={c}>{CLINIC_LABEL[c]}</option>
          ))}
        </select>
      </div>
      <label className="remember">
        <input type="checkbox" name="remember" value="1" defaultChecked={!compact} /> Remember: next time the narration contains
      </label>
      <div className="debit-fields">
        <input name="pattern" defaultValue={suggestPattern(txn.narration)} aria-label="Text to look for in future narrations" />
        <button type="submit" className="small">Save</button>
      </div>
    </form>
  );
}
