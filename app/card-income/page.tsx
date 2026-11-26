import { requireAdmin } from "@/lib/auth";
import { getStore } from "@/lib/data/store";
import { cardDaysOverdue, cardDueDate, inr, todayInIndia } from "@/lib/calc";
import { CLINIC_LABEL } from "@/lib/types";
import { toggleCardCredited } from "../actions";

export const dynamic = "force-dynamic";

export default async function CardIncomePage() {
  await requireAdmin();
  const d = await getStore().read();
  const pending = d.cardPayments.filter((c) => !c.creditedOn).sort((a, b) => a.date.localeCompare(b.date));
  const done = d.cardPayments.filter((c) => c.creditedOn).sort((a, b) => b.date.localeCompare(a.date));
  const total = pending.reduce((s, c) => s + c.amount, 0);
  // Each card payment is due in the clinic account by the last day of its own month.
  const today = todayInIndia();
  const overdue = pending.filter((c) => cardDaysOverdue(c.date, today) > 0);
  const overdueTotal = overdue.reduce((s, c) => s + c.amount, 0);
  const thisMonth = pending.filter((c) => cardDaysOverdue(c.date, today) <= 0);
  const thisMonthTotal = thisMonth.reduce((s, c) => s + c.amount, 0);
  const daysLeft = -cardDaysOverdue(today, today);
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

  return (
    <>
      <h1>Card income pending</h1>
      <p className="muted">
        Card payments recorded in PappyJoe that the doctor collected and has not yet paid into the clinic account.
      </p>
      <p className="muted">
        Card payments are added here when a PappyJoe export is imported. Reconcile suggests which bank credit paid each one in.
      </p>

      <div className="grid">
        <div className="card stat">
          <div className="label">Still to credit to the clinic account</div>
          <div className={`value ${total ? "neg" : "pos"}`}>{inr(total)}</div>
          <div className="muted">{plural(pending.length, "payment")}</div>
        </div>
        {overdue.length > 0 && (
          <div className="card stat">
            <div className="label">Overdue (from earlier months)</div>
            <div className="value neg">{inr(overdueTotal)}</div>
            <div className="muted">
              {plural(overdue.length, "payment")} · oldest was due by {cardDueDate(overdue[0].date)}
            </div>
          </div>
        )}
        {thisMonth.length > 0 && (
          <div className="card stat">
            <div className="label">Due this month</div>
            <div className="value">{inr(thisMonthTotal)}</div>
            <div className="muted">
              {plural(thisMonth.length, "payment")} · {daysLeft === 0 ? "due today" : `month ends in ${plural(daysLeft, "day")}`}
            </div>
          </div>
        )}
      </div>

      <h2>Pending</h2>
      <div className="table-wrap">
        <table className="stack">
          <thead>
            <tr>
              <th>Date</th>
              <th>Clinic</th>
              <th>Patient ref</th>
              <th className="num">Amount</th>
              <th>Due by</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {pending.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">Nothing pending.</td>
              </tr>
            )}
            {pending.map((c) => (
              <tr key={c.id}>
                <td data-label="Date">{c.date}</td>
                <td data-label="Clinic">{CLINIC_LABEL[c.clinic]}</td>
                <td data-label="Patient ref">{c.patientRef}</td>
                <td data-label="Amount" className="num strong">{inr(c.amount)}</td>
                <td data-label="Due by">
                  <DueBadge date={c.date} today={today} />
                </td>
                <td className="actions">
                  <form action={toggleCardCredited}>
                    <input type="hidden" name="id" value={c.id} />
                    <input type="hidden" name="credited" value="1" />
                    <button type="submit" className="small">Mark credited</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Credited to the clinic account</h2>
      <div className="table-wrap">
        <table className="stack">
          <thead>
            <tr>
              <th>Date</th>
              <th>Clinic</th>
              <th>Patient ref</th>
              <th className="num">Amount</th>
              <th>Credited on</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {done.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">Nothing credited yet.</td>
              </tr>
            )}
            {done.map((c) => (
              <tr key={c.id}>
                <td data-label="Date">{c.date}</td>
                <td data-label="Clinic">{CLINIC_LABEL[c.clinic]}</td>
                <td data-label="Patient ref">{c.patientRef}</td>
                <td data-label="Amount" className="num strong">{inr(c.amount)}</td>
                <td data-label="Credited on">{c.creditedOn}</td>
                <td className="actions">
                  <form action={toggleCardCredited}>
                    <input type="hidden" name="id" value={c.id} />
                    <input type="hidden" name="credited" value="0" />
                    <button type="submit" className="small secondary">Undo</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function DueBadge({ date, today }: { date: string; today: string }) {
  const due = cardDueDate(date);
  const late = cardDaysOverdue(date, today);
  if (late > 0)
    return (
      <>
        {due} <span className="badge open">Overdue {late} day{late === 1 ? "" : "s"}</span>
      </>
    );
  return <>{due}</>;
}
