"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { addExpense, type ExpenseFormState } from "@/app/actions";
import { PAYEE_KIND_LABEL, type ClinicId, type Payee, type PayeeKind } from "@/lib/types";

const NEW_PAYEE = "__new__";
/** Above this many names the payee question uses a dropdown instead of buttons. */
const MAX_PAYEE_CHIPS = 8;

const PAYEE_QUESTION: Record<PayeeKind, string> = {
  staff: "Salary for",
  lab: "Which lab?",
  pharma: "Which pharmacy or supplier?",
  supplier: "Which supplier?",
  consultant: "Which consultant?",
};

const CLINIC_OPTIONS = [
  ["SDC1", "SDC 1"],
  ["SDC2", "SDC 2"],
  ["SHARED", "Shared"],
] as const;
const PAID_BY_OPTIONS = [
  ["PETTY_CASH", "Petty cash"],
  ["UPI", "UPI"],
  ["BANK", "Bank"],
] as const;
const PAPPYJOE_OPTIONS = [
  ["YES", "Yes"],
  ["NO", "No"],
  ["NA", "Not applicable"],
] as const;

// Remembered on this phone only, so the next entry starts with the same answers.
const REMEMBER = { clinic: "sdc.expense.clinic", paidBy: "sdc.expense.paidBy" };

function recall(key: string, allowed: readonly (readonly [string, string])[]): string | null {
  try {
    const v = window.localStorage.getItem(key);
    return v && allowed.some(([a]) => a === v) ? v : null;
  } catch {
    return null;
  }
}
function remember(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* private mode or storage blocked: just don't remember */
  }
}

function localDate(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function Segmented({
  name,
  options,
  value,
  onChange,
  required,
  label,
}: {
  name: string;
  options: readonly (readonly [string, string])[];
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  label: string;
}) {
  return (
    <fieldset className="field">
      <legend>{label}</legend>
      <div className="segmented" style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}>
        {options.map(([v, l]) => (
          <label key={v}>
            <input type="radio" name={name} value={v} checked={value === v} onChange={() => onChange(v)} required={required} />
            <span>{l}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

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
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("");
  const [payeeChoice, setPayeeChoice] = useState("");
  const [newPayeeName, setNewPayeeName] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [clinic, setClinic] = useState<string>(defaultClinic ?? "SDC1");
  const [paidBy, setPaidBy] = useState<string>("PETTY_CASH");
  const [pettyBox, setPettyBox] = useState<string>(defaultClinic ?? "SDC1");
  // Starts as "Not applicable" on every new entry (Vivek, 2026-11-26); not remembered.
  const [inPappyJoe, setInPappyJoe] = useState("NA");
  const [todayLocal, setTodayLocal] = useState(today);
  const [dateMode, setDateMode] = useState<"today" | "yesterday" | "other">("today");
  const [otherDate, setOtherDate] = useState(today);
  const [showNote, setShowNote] = useState(false);
  const [note, setNote] = useState("");
  const amountRef = useRef<HTMLInputElement>(null);
  const lastState = useRef(state);

  // Start from the answers used last time on this phone, and from the phone's own date.
  useEffect(() => {
    const c = recall(REMEMBER.clinic, CLINIC_OPTIONS);
    if (c) setClinic(c);
    const p = recall(REMEMBER.paidBy, PAID_BY_OPTIONS);
    if (p) setPaidBy(p);
    const t = localDate();
    setTodayLocal(t);
    setOtherDate(t);
  }, []);

  // After a successful save, clear what changes per bill and keep the rest for the next one.
  useEffect(() => {
    if (state === lastState.current) return;
    lastState.current = state;
    if (!state.ok) return;
    setAmount("");
    setCategory("");
    setPayeeChoice("");
    setNewPayeeName("");
    setInvoiceNo("");
    setNote("");
    setShowNote(false);
    setInPappyJoe("NA");
    amountRef.current?.focus();
  }, [state]);

  const kind = categoryPayeeKind[category];
  const options = kind ? payees.filter((p) => p.kind === kind && p.active) : [];
  const needsInvoice = invoiceCategories.includes(category);
  const date = dateMode === "today" ? todayLocal : dateMode === "yesterday" ? localDate(-1) : otherDate;

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    remember(REMEMBER.clinic, clinic);
    remember(REMEMBER.paidBy, paidBy);
    const fd = new FormData(e.currentTarget);
    startTransition(() => action(fd));
  }

  return (
    <form onSubmit={submit} className="expense-form">
      <div className="amount-field">
        <label htmlFor="amount">Amount</label>
        <div className="amount-input">
          <span aria-hidden="true">₹</span>
          <input
            ref={amountRef}
            id="amount"
            name="amount"
            type="number"
            inputMode="decimal"
            min="1"
            step="0.01"
            required
            placeholder="0"
            autoComplete="off"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
      </div>

      <fieldset className="field">
        <legend>What for?</legend>
        <div className="tiles">
          {categories.map((c) => (
            <label key={c}>
              <input
                type="radio"
                name="category"
                value={c}
                required
                checked={category === c}
                onChange={() => {
                  setCategory(c);
                  setPayeeChoice("");
                }}
              />
              <span>{c}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {kind && (
        <div className="follow-up">
          {options.length > MAX_PAYEE_CHIPS ? (
            <>
              <label htmlFor="payeeId">{PAYEE_QUESTION[kind]}</label>
              <select id="payeeId" name="payeeId" required value={payeeChoice} onChange={(e) => setPayeeChoice(e.target.value)}>
                <option value="" disabled>Choose…</option>
                {options.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
                <option value={NEW_PAYEE}>+ Someone new…</option>
              </select>
            </>
          ) : (
            <fieldset className="field">
              <legend>{PAYEE_QUESTION[kind]}</legend>
              <div className="chips">
                {options.map((p) => (
                  <label key={p.id}>
                    <input
                      type="radio"
                      name="payeeId"
                      value={p.id}
                      required
                      checked={payeeChoice === p.id}
                      onChange={() => setPayeeChoice(p.id)}
                    />
                    <span>{p.name}</span>
                  </label>
                ))}
                <label className="add">
                  <input
                    type="radio"
                    name="payeeId"
                    value={NEW_PAYEE}
                    required
                    checked={payeeChoice === NEW_PAYEE}
                    onChange={() => setPayeeChoice(NEW_PAYEE)}
                  />
                  <span>+ Someone new</span>
                </label>
              </div>
            </fieldset>
          )}
          {payeeChoice === NEW_PAYEE && (
            <>
              <label htmlFor="newPayeeName">New {PAYEE_KIND_LABEL[kind].toLowerCase()} name</label>
              <input
                id="newPayeeName"
                name="newPayeeName"
                type="text"
                required
                maxLength={100}
                autoComplete="off"
                autoCapitalize="words"
                enterKeyHint="next"
                value={newPayeeName}
                onChange={(e) => setNewPayeeName(e.target.value)}
              />
            </>
          )}
          <input type="hidden" name="payeeKind" value={kind} />
        </div>
      )}

      {needsInvoice && (
        <div className="follow-up">
          <label htmlFor="invoiceNo">
            {kind === "lab" ? "Lab invoice number" : kind === "pharma" ? "Pharmacy invoice number" : "Invoice number"}
          </label>
          <input
            id="invoiceNo"
            name="invoiceNo"
            type="text"
            required
            maxLength={60}
            autoComplete="off"
            autoCapitalize="characters"
            enterKeyHint="done"
            value={invoiceNo}
            onChange={(e) => setInvoiceNo(e.target.value)}
          />
        </div>
      )}

      <Segmented name="clinic" label="Clinic" options={CLINIC_OPTIONS} value={clinic} onChange={setClinic} />
      <Segmented name="paidBy" label="Paid by" options={PAID_BY_OPTIONS} value={paidBy} onChange={setPaidBy} />

      {paidBy === "PETTY_CASH" && clinic === "SHARED" && (
        <Segmented
          name="pettyCashClinic"
          label="Which petty cash box paid?"
          options={CLINIC_OPTIONS.slice(0, 2)}
          value={pettyBox}
          onChange={setPettyBox}
        />
      )}

      <Segmented
        name="inPappyJoe"
        label="Already in PappyJoe?"
        options={PAPPYJOE_OPTIONS}
        value={inPappyJoe}
        onChange={setInPappyJoe}
        required
      />

      <fieldset className="field">
        <legend>Date</legend>
        <div className="segmented" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
          {(
            [
              ["today", "Today"],
              ["yesterday", "Yesterday"],
              ["other", "Pick date"],
            ] as const
          ).map(([v, l]) => (
            <label key={v}>
              <input type="radio" name="dateMode" checked={dateMode === v} onChange={() => setDateMode(v)} />
              <span>{l}</span>
            </label>
          ))}
        </div>
        {dateMode === "other" ? (
          <input
            className="date-input"
            type="date"
            aria-label="Date of the expense"
            required
            value={otherDate}
            onChange={(e) => setOtherDate(e.target.value)}
          />
        ) : null}
        <input type="hidden" name="date" value={date} />
      </fieldset>

      {showNote || note ? (
        <>
          <label htmlFor="note">Note</label>
          <input
            id="note"
            name="note"
            type="text"
            placeholder="What was it for? (optional)"
            enterKeyHint="done"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            autoFocus={showNote && !note}
          />
        </>
      ) : (
        <button type="button" className="add-note" onClick={() => setShowNote(true)}>
          + Add a note (optional)
        </button>
      )}

      <div className="save-bar">
        <button type="submit" className="full" disabled={pending}>
          {pending ? "Saving…" : amount ? `Save ₹${Number(amount).toLocaleString("en-IN")}` : "Save expense"}
        </button>
        <div aria-live="polite">
          {state.ok && <p className="ok">✓ {state.ok}</p>}
          {state.error && <p className="err">{state.error}</p>}
        </div>
      </div>
    </form>
  );
}
