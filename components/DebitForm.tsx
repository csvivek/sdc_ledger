import { counterparty, suggestPattern } from "@/lib/import/hdfc";
import { inr } from "@/lib/calc";
import type { BankTxn } from "@/lib/types";
import { DebitFormFields } from "./DebitFormFields";

/** One bank debit with a small form to say what it is. Used for the "needs your answer" list and to correct a guess. */
export function DebitForm({ txn, categories, compact = false }: { txn: BankTxn; categories: string[]; compact?: boolean }) {
  const cp = counterparty(txn.narration);
  const current = txn.kind === "EXPENSE" ? `EXPENSE:${txn.category}` : txn.kind === "UNKNOWN_OUT" ? "" : txn.kind;
  const head = compact ? null : (
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
  );
  return (
    <DebitFormFields
      id={txn.id}
      categories={categories}
      compact={compact}
      current={current}
      clinic={txn.clinic ?? "SHARED"}
      pattern={suggestPattern(txn.narration)}
      head={head}
    />
  );
}
