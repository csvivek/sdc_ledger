import { requireUser } from "@/lib/auth";
import { getStore } from "@/lib/data/store";
import { inr } from "@/lib/calc";
import { CLINIC_LABEL, IN_PAPPYJOE_LABEL, PAID_BY_LABEL } from "@/lib/types";
import { ExpenseForm } from "@/components/ExpenseForm";

export const dynamic = "force-dynamic";

export default async function ExpensesPage() {
  const user = await requireUser();
  const isAdmin = user.role === "admin";
  const [d, recent] = await Promise.all([getStore().formOptions(), getStore().recentExpenses(isAdmin ? 30 : 8)]);
  const today = new Date().toISOString().slice(0, 10);
  // The fake-data store returns everyone's entries, so keep the staff filter.
  const mine = recent.expenses.filter((e) => isAdmin || e.enteredBy === user.id);
  const payeeNames = Object.fromEntries(d.payees.map((p) => [p.id, p.name]));
  const names = Object.fromEntries(recent.users.map((u) => [u.id, u.name]));

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

      <h2>{user.role === "admin" ? "Latest entries" : "Your latest entries"}</h2>
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
              {user.role === "admin" && <th>Entered by</th>}
            </tr>
          </thead>
          <tbody>
            {mine.length === 0 && (
              <tr>
                <td colSpan={10} className="muted">Nothing entered yet.</td>
              </tr>
            )}
            {mine.map((e) => (
              <tr key={e.id}>
                <td data-label="Date">{e.date}</td>
                <td data-label="Amount" className="num strong">{inr(e.amount)}</td>
                <td data-label="Category">{e.category}</td>
                <td data-label="Paid to">{e.payeeId ? (payeeNames[e.payeeId] ?? "") : ""}</td>
                <td data-label="Invoice no.">{e.invoiceNo ?? ""}</td>
                <td data-label="In PappyJoe?">{e.inPappyJoe ? IN_PAPPYJOE_LABEL[e.inPappyJoe] : <span className="muted">not asked</span>}</td>
                <td data-label="Clinic">{CLINIC_LABEL[e.clinic]}</td>
                <td data-label="Paid by">
                  {PAID_BY_LABEL[e.paidBy]}
                  {e.paidBy === "PETTY_CASH" && e.clinic === "SHARED" && e.pettyCashClinic ? ` (${CLINIC_LABEL[e.pettyCashClinic].slice(0, 5)})` : ""}
                </td>
                <td data-label="Note" className="wrap">{e.note}</td>
                {user.role === "admin" && <td data-label="Entered by">{names[e.enteredBy] ?? e.enteredBy}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
