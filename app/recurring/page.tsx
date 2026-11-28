import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { getStore } from "@/lib/data/store";
import { getExtras } from "@/lib/data/extras";
import { inr, monthLabel, todayInIndia } from "@/lib/calc";
import { isMonthKey, monthRange, shiftMonth } from "@/lib/expense-view";
import { matches } from "@/lib/recon";
import { closedMonths } from "@/lib/closed-months";
import { describeTemplate, monthItems, toAddAll } from "@/lib/recurring";
import { TemplateForm } from "@/components/RecurringForms";
import { RecurringMonth } from "@/components/RecurringMonth";
import { toggleTemplateAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function RecurringPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const current = todayInIndia().slice(0, 7);
  // From a year back to next month.
  const month = isMonthKey(sp.month) && sp.month >= shiftMonth(current, -12) && sp.month <= shiftMonth(current, 1) ? sp.month : current;
  const label = monthLabel(month);
  const [list, d, closed] = await Promise.all([getExtras().listTemplates(), getStore().read(), closedMonths()]);

  if (!list.ready) {
    return (
      <>
        <h1>Recurring expenses</h1>
        <p className="notice">
          Recurring expenses are not switched on yet. Run the SQL file for this feature in Supabase (SQL editor), then reload this page.
        </p>
      </>
    );
  }

  const templates = list.value;
  const items = monthItems(templates, month, d.expenses);
  const todo = toAddAll(items);
  const isClosed = closed.has(month);
  const { from, to } = monthRange(month);
  const bankMatched = matches(d).expenseMatched;
  const prev = shiftMonth(month, -1);
  const next = shiftMonth(month, 1);
  const formProps = { categories: d.categories, categoryPayeeKind: d.categoryPayeeKind, invoiceCategories: d.invoiceCategories, payees: d.payees };

  return (
    <>
      <h1>Recurring expenses</h1>
      <p className="muted">
        Monthly costs such as rent, salaries and EB. Add each one with one tap, or all at once. Each is saved as a normal expense, so it
        matches its bank payment on the Reconcile page as usual, and it can only be added once a month.
      </p>

      <div className="entries-nav">
        {month > shiftMonth(current, -12) ? (
          <Link className="arrow" href={`/recurring?month=${prev}`} aria-label={`Show ${monthLabel(prev)}`}>‹</Link>
        ) : (
          <span className="arrow off" aria-hidden="true">‹</span>
        )}
        <strong className="strong">{isClosed ? "🔒 " : ""}{label}</strong>
        {month < shiftMonth(current, 1) ? (
          <Link className="arrow" href={`/recurring?month=${next}`} aria-label={`Show ${monthLabel(next)}`}>›</Link>
        ) : (
          <span className="arrow off" aria-hidden="true">›</span>
        )}
      </div>

      <RecurringMonth
        templates={templates}
        items={items}
        todo={todo}
        month={month}
        label={label}
        isClosed={isClosed}
        from={from}
        to={to}
        bankMatched={bankMatched}
        payees={d.payees}
      />

      <h2>The list</h2>
      <details className="card">
        <summary>Add a recurring expense</summary>
        <TemplateForm {...formProps} />
      </details>
      {templates.map((t) => (
        <details key={t.id} className={`card${t.active ? "" : " off"}`}>
          <summary>
            {t.label} · {inr(t.amount)} {t.active ? "" : "(hidden)"}
          </summary>
          <p className="muted small-text">{describeTemplate(t, d.payees)}</p>
          <TemplateForm {...formProps} template={t} />
          <form action={toggleTemplateAction}>
            <input type="hidden" name="id" value={t.id} />
            <input type="hidden" name="active" value={t.active ? "0" : "1"} />
            <button type="submit" className="secondary full">
              {t.active ? "Hide from the monthly list" : "Show in the monthly list again"}
            </button>
          </form>
        </details>
      ))}
      <p className="muted small-text">
        Categories that need an invoice number every time (such as Lab) are not offered here; enter those on Add expense.
      </p>
    </>
  );
}
