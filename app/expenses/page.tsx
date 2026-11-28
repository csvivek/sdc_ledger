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

  return (
    <>
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
