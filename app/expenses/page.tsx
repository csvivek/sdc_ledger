import { requireUser } from "@/lib/auth";
import { getStore } from "@/lib/data/store";
import { inr } from "@/lib/calc";
import { CLINIC_LABEL, PAID_BY_LABEL } from "@/lib/types";
import { ExpenseForm } from "@/components/ExpenseForm";

export const dynamic = "force-dynamic";

export default async function ExpensesPage() {
  const user = await requireUser();
  const d = await getStore().read();
  const today = new Date().toISOString().slice(0, 10);
  const mine = d.expenses
    .filter((e) => user.role === "admin" || e.enteredBy === user.id)
    .sort((a, b) => b.enteredAt.localeCompare(a.enteredAt))
    .slice(0, 8);
  const names = Object.fromEntries(d.users.map((u) => [u.id, u.name]));

  return (
    <>
      <h1>Add expense</h1>
      <div className="card" style={{ maxWidth: 520 }}>
        <ExpenseForm categories={d.categories} defaultClinic={user.clinic} today={today} />
      </div>

      <h2>{user.role === "admin" ? "Latest entries" : "Your latest entries"}</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th className="num">Amount</th>
              <th>Category</th>
              <th>Clinic</th>
              <th>Paid by</th>
              <th>Note</th>
              {user.role === "admin" && <th>Entered by</th>}
            </tr>
          </thead>
          <tbody>
            {mine.map((e) => (
              <tr key={e.id}>
                <td>{e.date}</td>
                <td className="num">{inr(e.amount)}</td>
                <td>{e.category}</td>
                <td>{CLINIC_LABEL[e.clinic]}</td>
                <td>
                  {PAID_BY_LABEL[e.paidBy]}
                  {e.paidBy === "PETTY_CASH" && e.clinic === "SHARED" && e.pettyCashClinic ? ` (${CLINIC_LABEL[e.pettyCashClinic].slice(0, 5)})` : ""}
                </td>
                <td>{e.note}</td>
                {user.role === "admin" && <td>{names[e.enteredBy] ?? e.enteredBy}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
