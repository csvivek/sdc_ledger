import { inr } from "@/lib/calc";
import { describeTemplate, type MonthItem, type RecurringTemplate } from "@/lib/recurring";
import type { Payee } from "@/lib/types";
import { AddAllForm, AddOneForm } from "@/components/RecurringForms";

/** This month's recurring expenses with Add buttons (Recurring page and Add expense). */
export function RecurringMonth({
  templates,
  items,
  todo,
  month,
  label,
  isClosed,
  from,
  to,
  bankMatched,
  payees,
}: {
  templates: RecurringTemplate[];
  items: MonthItem[];
  todo: MonthItem[];
  month: string;
  label: string;
  isClosed: boolean;
  from: string;
  to: string;
  bankMatched: Set<string>;
  payees: Payee[];
}) {
  const done = items.filter((i) => i.added).length;
  return (
    <>
      {!templates.some((t) => t.active) ? (
        <p className="notice">The list is empty. Add your monthly expenses below, once, and they show up here every month.</p>
      ) : (
        <>
          <p className="muted">
            {done} of {items.length} added for {label}.
          </p>
          {isClosed && <p className="notice">{label} is closed, so nothing can be added. Reopen it in Books › Close first.</p>}
          <ul className="recurring-list">
            {items.map(({ template: t, date, added, lookalike }) => (
              <li key={t.id}>
                <div className="top-line">
                  <strong>{t.label}</strong>
                  {added ? (
                    <span className="badge done">Added</span>
                  ) : lookalike ? (
                    <span className="badge open">Check</span>
                  ) : null}
                </div>
                <div className="muted small-text">{describeTemplate(t, payees)}</div>
                {added ? (
                  <p className="muted small-text">
                    {inr(added.amount)} on {added.date}
                    {added.amount !== t.amount ? ` (usual ${inr(t.amount)})` : ""} ·{" "}
                    {added.paidBy === "PETTY_CASH" ? "petty cash" : bankMatched.has(added.id) ? "matched to the bank payment ✓" : "bank payment not matched yet"}
                  </p>
                ) : (
                  <>
                    {lookalike && (
                      <p className="muted small-text">
                        A matching entry was already typed by hand: {inr(lookalike.amount)} on {lookalike.date}. Add all skips this one; add it
                        only if it is a second payment.
                      </p>
                    )}
                    {!isClosed && t.active && <AddOneForm month={month} id={t.id} label={t.label} amount={t.amount} date={date} min={from} max={to} />}
                  </>
                )}
              </li>
            ))}
          </ul>
          {!isClosed && <AddAllForm month={month} count={todo.length} total={inr(todo.reduce((s, i) => s + i.template.amount, 0))} label={label} />}
        </>
      )}

    </>
  );
}
