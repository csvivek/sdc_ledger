"use client";

import { useActionState, useState } from "react";
import { addAllRecurringAction, addRecurringAction, saveTemplateAction, type RecurringState } from "@/app/recurring/actions";
import type { RecurringTemplate } from "@/lib/recurring";
import { CLINIC_LABEL, PAYEE_KIND_LABEL, type Payee, type PayeeKind } from "@/lib/types";

function Feedback({ s }: { s: RecurringState }) {
  return (
    <div aria-live="polite">
      {s.ok && <p className="ok">✓ {s.ok}</p>}
      {s.error && <p className="err">{s.error}</p>}
    </div>
  );
}

/** One tap: the amount and date are filled in and can be changed before adding. */
export function AddOneForm({ month, id, label, amount, date, min, max }: { month: string; id: string; label: string; amount: number; date: string; min: string; max: string }) {
  const [state, action, pending] = useActionState<RecurringState, FormData>(addRecurringAction, {});
  return (
    <form action={action} className="recurring-add">
      <input type="hidden" name="month" value={month} />
      <input type="hidden" name="id" value={id} />
      <div className="recurring-fields">
        <label>
          <span className="sr-only">Amount for {label}</span>
          <span aria-hidden="true">₹</span>
          <input name="amount" type="number" inputMode="decimal" step="0.01" min="1" defaultValue={amount} required />
        </label>
        <label>
          <span className="sr-only">Date paid for {label}</span>
          <input name="date" type="date" defaultValue={date} min={min} max={max} required />
        </label>
        <button type="submit" disabled={pending}>{pending ? "Adding…" : "Add"}</button>
      </div>
      <Feedback s={state} />
    </form>
  );
}

export function AddAllForm({ month, count, total, label }: { month: string; count: number; total: string; label: string }) {
  const [state, action, pending] = useActionState<RecurringState, FormData>(addAllRecurringAction, {});
  return (
    <form action={action} className="card form-card">
      <input type="hidden" name="month" value={month} />
      <button type="submit" className="full" disabled={pending || count === 0}>
        {pending ? "Adding…" : count ? `Add all ${count} remaining for ${label} (${total})` : `Nothing left to add for ${label}`}
      </button>
      {count > 0 && <p className="muted">Each is added at its usual amount and day. Change an amount first with its own Add button if it differs this month.</p>}
      <Feedback s={state} />
    </form>
  );
}

interface TemplateFormProps {
  template?: RecurringTemplate;
  categories: string[];
  categoryPayeeKind: Record<string, PayeeKind>;
  invoiceCategories: string[];
  payees: Payee[];
}

export function TemplateForm({ template: t, categories, categoryPayeeKind, invoiceCategories, payees }: TemplateFormProps) {
  const [state, action, pending] = useActionState<RecurringState, FormData>(saveTemplateAction, {});
  const [category, setCategory] = useState(t?.category ?? "");
  const [clinic, setClinic] = useState<string>(t?.clinic ?? "");
  const [paidBy, setPaidBy] = useState<string>(t?.paidBy ?? "BANK");
  const kind = categoryPayeeKind[category];
  const options = kind ? payees.filter((p) => p.kind === kind && (p.active || p.id === t?.payeeId)) : [];
  const usable = categories.filter((c) => !invoiceCategories.includes(c));
  const f = (n: string) => `${t?.id ?? "new"}-${n}`;
  return (
    <form action={action} className="form-card template-form">
      {t && <input type="hidden" name="id" value={t.id} />}
      <label htmlFor={f("label")}>Name</label>
      <input id={f("label")} name="label" required minLength={2} maxLength={80} defaultValue={t?.label} placeholder="e.g. Rent SDC 1" autoComplete="off" />

      <label htmlFor={f("category")}>Category</label>
      <select id={f("category")} name="category" required value={category} onChange={(e) => setCategory(e.target.value)}>
        <option value="">Pick…</option>
        {usable.map((c) => (
          <option key={c}>{c}</option>
        ))}
        {t && !usable.includes(t.category) && <option value={t.category}>{t.category} (not usable)</option>}
      </select>

      {kind && (
        <>
          <label htmlFor={f("payee")}>{PAYEE_KIND_LABEL[kind]}</label>
          <select id={f("payee")} name="payeeId" required defaultValue={t?.payeeId ?? ""} key={category}>
            <option value="">Pick…</option>
            {options.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          {!options.length && <p className="muted">No names yet. Add one on the Payees page first.</p>}
        </>
      )}

      <label htmlFor={f("clinic")}>Clinic</label>
      <select id={f("clinic")} name="clinic" required value={clinic} onChange={(e) => setClinic(e.target.value)}>
        <option value="">Pick…</option>
        {(["SDC1", "SDC2", "SHARED"] as const).map((c) => (
          <option key={c} value={c}>{CLINIC_LABEL[c]}</option>
        ))}
      </select>

      <label htmlFor={f("paidBy")}>Paid by</label>
      <select id={f("paidBy")} name="paidBy" required value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
        <option value="BANK">Bank transfer</option>
        <option value="UPI">UPI</option>
        <option value="PETTY_CASH">Petty cash</option>
      </select>

      {paidBy === "PETTY_CASH" && clinic === "SHARED" && (
        <>
          <label htmlFor={f("pcc")}>Whose petty cash?</label>
          <select id={f("pcc")} name="pettyCashClinic" required defaultValue={t?.pettyCashClinic ?? ""}>
            <option value="">Pick…</option>
            <option value="SDC1">SDC1</option>
            <option value="SDC2">SDC2</option>
          </select>
        </>
      )}

      <div className="two-col">
        <div>
          <label htmlFor={f("amount")}>Usual amount (₹)</label>
          <input id={f("amount")} name="amount" type="number" inputMode="decimal" step="0.01" min="1" required defaultValue={t?.amount} />
        </div>
        <div>
          <label htmlFor={f("day")}>Usual day</label>
          <input id={f("day")} name="dayOfMonth" type="number" inputMode="numeric" min="1" max="31" required defaultValue={t?.dayOfMonth ?? 5} />
        </div>
      </div>

      <label htmlFor={f("note")}>Note (optional)</label>
      <input id={f("note")} name="note" maxLength={200} defaultValue={t?.note} autoComplete="off" />

      <button type="submit" className="full" disabled={pending}>{pending ? "Saving…" : t ? "Save changes" : "Add to the list"}</button>
      <Feedback s={state} />
    </form>
  );
}
