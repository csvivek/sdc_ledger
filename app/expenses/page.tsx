import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getStore } from "@/lib/data/store";
import { inr, monthLabel, todayInIndia } from "@/lib/calc";
import {
  CLINIC_FILTERS,
  entriesHref,
  entryTotals,
  filterByClinic,
  monthOptions,
  pickClinic,
  pickView,
} from "@/lib/expense-view";
import { CLINIC_LABEL, IN_PAPPYJOE_LABEL, PAID_BY_LABEL } from "@/lib/types";
import { EntriesMonthNav } from "@/components/EntriesMonthNav";
import { ExpenseCategoryForm } from "@/components/ExpenseCategoryForm";
import { ExpenseForm } from "@/components/ExpenseForm";
import { RecurringMonth } from "@/components/RecurringMonth";
import { getExtras } from "@/lib/data/extras";
import { closedMonths } from "@/lib/closed-months";
import { matches } from "@/lib/recon";
import { monthItems, toAddAll } from "@/lib/recurring";
import { monthRange } from "@/lib/expense-view";
import { staffPettyMonth } from "@/lib/staff-petty";

export const dynamic = "force-dynamic";

/** More rows than a clinic enters in a month; the page says so if a month ever has more. */
const MONTH_LIMIT = 1000;

/** "27 Nov" in India time. */
const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });

const CLINIC_FILTER_LABEL = { ALL: "All", SDC1: "SDC 1", SDC2: "SDC 2", SHARED: "Shared" } as const;

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<{ view?: string; clinic?: string }> }) {
  const user = await requireUser();
  const isAdmin = user.role === "admin";
  const sp = await searchParams;
  const store = getStore();
  const [d, firstDate] = await Promise.all([store.formOptions(), store.firstExpenseDate()]);
  const months = monthOptions(firstDate, todayInIndia().slice(0, 7));
  const view = pickView(sp.view, months);
  const clinic = view === "latest" ? "ALL" : pickClinic(sp.clinic);

  const list =
    view === "latest"
      ? { ...(await store.recentExpenses(isAdmin ? 30 : 8)), more: false }
      : await store.monthExpenses(view, MONTH_LIMIT);
  const today = new Date().toISOString().slice(0, 10);
  // The fake-data store returns everyone's entries, so keep the staff filter.
  const mine = list.expenses.filter((e) => isAdmin || e.enteredBy === user.id);
  const shown = filterByClinic(mine, clinic);
  const totals = entryTotals(mine);
  const payeeNames = Object.fromEntries(d.payees.map((p) => [p.id, p.name]));
  const names = Object.fromEntries(list.users.map((u) => [u.id, u.name]));
  // Admin sees when an entry's category was changed (newest change first).
  const changes = isAdmin ? await store.categoryChanges("expense", shown.map((e) => e.id)) : [];
  const lastChange = new Map<string, (typeof changes)[number]>();
  for (const c of changes) if (!lastChange.has(c.targetId)) lastChange.set(c.targetId, c);

  const thisMonth = todayInIndia().slice(0, 7);
  const recurring = isAdmin ? await recurringBox(thisMonth) : undefined;
  const petty = isAdmin ? undefined : await myPetty(user.id, thisMonth);

  return (
    <>
      {petty && (
        <div className="petty-card" aria-label="Petty cash">
          <div className="label">{CLINIC_LABEL[petty.clinic]} petty cash · left now</div>
          <div className="value">{inr(petty.left)}</div>
          <div className="split">
            <span>Carried in {inr(petty.carriedIn)}</span>
            <span>Received {inr(petty.received)}</span>
            <span>Spent {inr(petty.spent)}</span>
          </div>
        </div>
      )}
      <h1>Add expense</h1>
      <div className="card form-card">
        <ExpenseForm
          categories={d.categories}
          categoryPayeeKind={d.categoryPayeeKind}
          invoiceCategories={d.invoiceCategories}
          payees={d.payees}
          defaultClinic={user.clinic}
          today={today}
        />
      </div>

      {recurring}

      <h2 id="entries">
        {isAdmin ? "" : "Your "}
        {view === "latest" ? (isAdmin ? "Latest entries" : "latest entries") : `${isAdmin ? "Entries" : "entries"} in ${monthLabel(view)}`}
      </h2>
      <EntriesMonthNav view={view} months={months} clinic={clinic} />

      {view !== "latest" && (
        <>
          <div className="card entries-summary">
            <div className="muted">Month total</div>
            <div className="total">{inr(totals.total)}</div>
            <div className="muted">
              {totals.count} {totals.count === 1 ? "entry" : "entries"} dated in {monthLabel(view)}
            </div>
            {totals.count > 0 && (
              <div className="split muted">
                <span>SDC 1 <b>{inr(totals.byClinic.SDC1)}</b></span>
                <span>SDC 2 <b>{inr(totals.byClinic.SDC2)}</b></span>
                <span>Shared <b>{inr(totals.byClinic.SHARED)}</b></span>
              </div>
            )}
            {list.more && (
              <p className="muted">Only the newest {MONTH_LIMIT} entries are listed, so this total leaves some out.</p>
            )}
          </div>
          <nav className="month-picker" aria-label="Clinic">
            {CLINIC_FILTERS.map((c) => (
              <Link key={c} href={entriesHref(view, c)} className={c === clinic ? "active" : ""} scroll={false}>
                {CLINIC_FILTER_LABEL[c]}
              </Link>
            ))}
          </nav>
        </>
      )}
      <div className="table-wrap">
        <table className="stack">
          <thead>
            <tr>
              <th>Date</th>
              <th className="num">Amount</th>
              <th>Category</th>
              <th>Paid to</th>
              <th>Invoice no.</th>
              <th>In PappyJoe?</th>
              <th>Clinic</th>
              <th>Paid by</th>
              <th>Note</th>
              {isAdmin && <th>Entered by</th>}
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td colSpan={10} className="muted">
                  {view === "latest" ? "Nothing entered yet." : clinic === "ALL" ? `Nothing entered for ${monthLabel(view)}.` : `Nothing for ${CLINIC_LABEL[clinic]} in ${monthLabel(view)}.`}
                </td>
              </tr>
            )}
            {shown.map((e) => (
              <tr key={e.id}>
                <td data-label="Date">{e.date}</td>
                <td data-label="Amount" className="num strong">{inr(e.amount)}</td>
                <td data-label="Category" className="wrap cat-td">
                  <span>{e.category}</span>
                  {lastChange.has(e.id) && (
                    <span className="cat-history muted">
                      was {lastChange.get(e.id)!.oldValue} · changed by {names[lastChange.get(e.id)!.changedBy] ?? "admin"} on{" "}
                      {shortDate(lastChange.get(e.id)!.changedAt)}
                    </span>
                  )}
                  {isAdmin && <ExpenseCategoryForm id={e.id} current={e.category} categories={d.categories} />}
                </td>
                <td data-label="Paid to">{e.payeeId ? (payeeNames[e.payeeId] ?? "") : ""}</td>
                <td data-label="Invoice no.">{e.invoiceNo ?? ""}</td>
                <td data-label="In PappyJoe?">{e.inPappyJoe ? IN_PAPPYJOE_LABEL[e.inPappyJoe] : <span className="muted">not asked</span>}</td>
                <td data-label="Clinic">{CLINIC_LABEL[e.clinic]}</td>
                <td data-label="Paid by">
                  {PAID_BY_LABEL[e.paidBy]}
                  {e.paidBy === "PETTY_CASH" && e.clinic === "SHARED" && e.pettyCashClinic ? ` (${CLINIC_LABEL[e.pettyCashClinic].slice(0, 5)})` : ""}
                </td>
                <td data-label="Note" className="wrap">{e.note}</td>
                {isAdmin && <td data-label="Entered by">{names[e.enteredBy] ?? e.enteredBy}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** Admin: this month's recurring expenses, folded open while some are still to add. */
async function recurringBox(month: string) {
  const [list, d, closed] = await Promise.all([getExtras().listTemplates(), getStore().read(), closedMonths()]);
  if (!list.ready || !list.value.some((t) => t.active)) return undefined;
  const items = monthItems(list.value, month, d.expenses);
  const todo = toAddAll(items);
  const { from, to } = monthRange(month);
  const done = items.filter((i) => i.added).length;
  return (
    <details className="card" id="recurring" open={todo.length > 0}>
      <summary>
        Recurring for {monthLabel(month)} · {done} of {items.length} added
      </summary>
      <RecurringMonth
        templates={list.value}
        items={items}
        todo={todo}
        month={month}
        label={monthLabel(month)}
        isClosed={closed.has(month)}
        from={from}
        to={to}
        bankMatched={matches(d).expenseMatched}
        payees={d.payees}
      />
      <p className="muted small-text">
        Change the list in <Link href="/recurring">Settings › Recurring expenses</Link>.
      </p>
    </details>
  );
}

/** Staff: their own clinic's petty cash, or nothing if it cannot be worked out (e.g. its SQL is not run yet). */
async function myPetty(userId: string, month: string) {
  try {
    const r = await getExtras().myPettyCash(userId);
    if (!r.ready || !r.value) return undefined;
    const p = staffPettyMonth(r.value, month);
    return { clinic: r.value.clinic, left: p.expected, carriedIn: p.carriedIn, received: p.received, spent: p.spent };
  } catch (err) {
    console.error("my_petty_cash failed", err);
    return undefined;
  }
}
