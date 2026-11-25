"use client";

import { useActionState, useState } from "react";
import { addExpense, type ExpenseFormState } from "@/app/actions";
import { PAYEE_KIND_LABEL, type ClinicId, type Payee, type PayeeKind } from "@/lib/types";

const NEW_PAYEE = "__new__";

const PAYEE_QUESTION: Record<PayeeKind, string> = {
  staff: "Salary for which staff member?",
  lab: "Which lab?",
  pharma: "Which pharmacy or supplier?",
  consultant: "Consultant's name",
};

export function ExpenseForm({
  categories,
  categoryPayeeKind,
  invoiceCategories,
  payees,
  defaultClinic,
  today,
}: {
  categories: string[];
  categoryPayeeKind: Record<string, PayeeKind>;
  invoiceCategories: string[];
  payees: Payee[];
  defaultClinic?: ClinicId;
  today: string;
}) {
  const [state, action, pending] = useActionState<ExpenseFormState, FormData>(addExpense, {});
  const [clinic, setClinic] = useState<string>(defaultClinic ?? "SDC1");
  const [paidBy, setPaidBy] = useState<string>("PETTY_CASH");
  const [category, setCategory] = useState<string>("");
  const [payeeChoice, setPayeeChoice] = useState<string>("");

  const kind = categoryPayeeKind[category];
  const options = kind ? payees.filter((p) => p.kind === kind && p.active) : [];

  return (
    <form action={action}>
      <label htmlFor="amount">Amount (₹)</label>
      <input id="amount" name="amount" type="number" inputMode="decimal" min="1" step="0.01" required placeholder="0" />

      <label htmlFor="category">Category</label>
      <select
        id="category"
        name="category"
        required
        value={category}
        onChange={(e) => {
          setCategory(e.target.value);
          setPayeeChoice("");
        }}
      >
        <option value="" disabled>Choose…</option>
        {categories.map((c) => (
          <option key={c}>{c}</option>
        ))}
      </select>

      {kind && (
        <>
          <label htmlFor="payeeId">{PAYEE_QUESTION[kind]}</label>
          <select
            id="payeeId"
            name="payeeId"
            required
            value={payeeChoice}
            onChange={(e) => setPayeeChoice(e.target.value)}
          >
            <option value="" disabled>Choose…</option>
            {options.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
            <option value={NEW_PAYEE}>+ Add a new name…</option>
          </select>
          {payeeChoice === NEW_PAYEE && (
            <>
              <label htmlFor="newPayeeName">New {PAYEE_KIND_LABEL[kind].toLowerCase()} name</label>
              <input id="newPayeeName" name="newPayeeName" type="text" required maxLength={100} autoComplete="off" />
            </>
          )}
          <input type="hidden" name="payeeKind" value={kind} />
        </>
      )}

      {invoiceCategories.includes(category) && (
        <>
          <label htmlFor="invoiceNo">{kind === "lab" ? "Lab invoice number" : kind === "pharma" ? "Pharmacy invoice number" : "Invoice number"}</label>
          <input id="invoiceNo" name="invoiceNo" type="text" required maxLength={60} autoComplete="off" />
        </>
      )}

      <label>Clinic</label>
      <div className="chips">
        {[
          ["SDC1", "SDC 1"],
          ["SDC2", "SDC 2"],
          ["SHARED", "Shared"],
        ].map(([v, l]) => (
          <label key={v}>
            <input type="radio" name="clinic" value={v} checked={clinic === v} onChange={() => setClinic(v)} /> {l}
          </label>
        ))}
      </div>

      <label>Paid by</label>
      <div className="chips">
        {[
          ["PETTY_CASH", "Petty cash"],
          ["UPI", "UPI"],
          ["BANK", "Bank"],
        ].map(([v, l]) => (
          <label key={v}>
            <input type="radio" name="paidBy" value={v} checked={paidBy === v} onChange={() => setPaidBy(v)} /> {l}
          </label>
        ))}
      </div>

      {paidBy === "PETTY_CASH" && clinic === "SHARED" && (
        <>
          <label>Which petty cash box paid?</label>
          <div className="chips">
            <label><input type="radio" name="pettyCashClinic" value="SDC1" defaultChecked /> SDC 1</label>
            <label><input type="radio" name="pettyCashClinic" value="SDC2" /> SDC 2</label>
          </div>
        </>
      )}

      <label>Already entered in PappyJoe?</label>
      <div className="chips">
        {[
          ["YES", "Yes"],
          ["NO", "No"],
          ["NA", "Not applicable"],
        ].map(([v, l]) => (
          <label key={v}>
            <input type="radio" name="inPappyJoe" value={v} required /> {l}
          </label>
        ))}
      </div>

      <label htmlFor="date">Date</label>
      <input id="date" name="date" type="date" defaultValue={today} required />

      <label htmlFor="note">Note</label>
      <input id="note" name="note" type="text" placeholder="What was it for?" />

      <label className="muted" style={{ fontWeight: 400 }}>
        Bill photo: not in the prototype yet
      </label>

      <button type="submit" className="full" disabled={pending}>
        {pending ? "Saving…" : "Save expense"}
      </button>
      {state.ok && <p className="ok">{state.ok}</p>}
      {state.error && <p className="err">{state.error}</p>}
    </form>
  );
}
