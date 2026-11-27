"use client";

import { useActionState } from "react";
import { deleteRule, saveRule, type RuleFormState } from "@/app/import/actions";
import { CLINIC_LABEL, type BankRule } from "@/lib/types";

/** Edit one bank rule, or add a new one when no rule is given. Admin only (the actions check). */
export function RuleForm({ rule, categories, used = 0 }: { rule?: BankRule; categories: string[]; used?: number }) {
  const [state, save, saving] = useActionState<RuleFormState, FormData>(saveRule, {});
  const [delState, remove, deleting] = useActionState<RuleFormState, FormData>(deleteRule, {});
  const busy = saving || deleting;
  const choice = !rule ? "" : rule.action === "EXPENSE" ? `EXPENSE:${rule.category}` : rule.action;
  // A rule whose category was removed from the list still shows it, so saving does not silently change it.
  const cats = rule?.category && !categories.includes(rule.category) ? [...categories, rule.category] : categories;
  // Reset the fields after a successful add so the next rule starts empty.
  const formKey = rule ? rule.id : `new-${state.savedAt ?? 0}`;

  return (
    <form key={formKey} action={save} className="rule-form">
      {rule && <input type="hidden" name="id" value={rule.id} />}
      <label>
        Narration
        <select name="matchType" defaultValue={rule?.matchType ?? "contains"}>
          <option value="contains">Contains this text</option>
          <option value="regex">Matches this pattern (advanced)</option>
        </select>
      </label>
      <input name="pattern" defaultValue={rule?.pattern ?? ""} required minLength={2} maxLength={200} autoComplete="off" aria-label="Text to look for" placeholder="e.g. ZAHN ARTZ" />
      <div className="debit-fields">
        <label>
          Means
          <select name="choice" defaultValue={choice} required>
            <option value="" disabled>Choose…</option>
            <optgroup label="Expense">
              {cats.map((c) => (
                <option key={c} value={`EXPENSE:${c}`}>{c}</option>
              ))}
            </optgroup>
            <optgroup label="Not an expense">
              <option value="PETTY_CASH">Petty cash to clinics (split equally)</option>
              <option value="TRANSFER_OUT">Other transfer (not an expense)</option>
            </optgroup>
          </select>
        </label>
        <label>
          Clinic (expenses only)
          <select name="clinic" defaultValue={rule?.clinic ?? ""}>
            <option value="">From narration, else Shared</option>
            {(["SDC1", "SDC2", "SHARED"] as const).map((c) => (
              <option key={c} value={c}>{CLINIC_LABEL[c]}</option>
            ))}
          </select>
        </label>
        <label className="rule-order">
          Order
          <input name="priority" type="number" inputMode="numeric" min={1} max={999} step={1} required defaultValue={rule?.priority ?? 50} />
        </label>
      </div>
      {rule && used > 0 && (
        <label className="remember">
          <input type="checkbox" name="updateLinked" value="1" defaultChecked /> Also update the {used} payment(s) this rule already categorised
        </label>
      )}
      <div className="rule-buttons">
        <button type="submit" className="small" disabled={busy}>{saving ? "Saving…" : rule ? "Save rule" : "Add rule"}</button>
        {rule && (
          <button type="submit" formAction={remove} formNoValidate className="small secondary" disabled={busy}>
            {deleting ? "Deleting…" : "Delete rule"}
          </button>
        )}
      </div>
      {!busy && state.error && <p className="err" role="alert">{state.error}</p>}
      {!busy && delState.error && <p className="err" role="alert">{delState.error}</p>}
      {!busy && state.ok && !state.error && <p className="ok" role="status">✓ {state.ok}</p>}
    </form>
  );
}
