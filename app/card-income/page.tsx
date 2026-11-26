import { requireAdmin } from "@/lib/auth";
import { getStore } from "@/lib/data/store";
import { inr } from "@/lib/calc";
import { CLINIC_LABEL } from "@/lib/types";
import { toggleCardCredited } from "../actions";

export const dynamic = "force-dynamic";

export default async function CardIncomePage() {
  await requireAdmin();
  const d = await getStore().read();
  const pending = d.cardPayments.filter((c) => !c.creditedOn).sort((a, b) => a.date.localeCompare(b.date));
  const done = d.cardPayments.filter((c) => c.creditedOn).sort((a, b) => b.date.localeCompare(a.date));
  const total = pending.reduce((s, c) => s + c.amount, 0);
  const now = new Date();
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const daysLeft = Math.ceil((monthEnd.getTime() - now.getTime()) / 86400000);

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
          <div className="muted">
            {pending.length} payment{pending.length === 1 ? "" : "s"} · month ends in {daysLeft} day{daysLeft === 1 ? "" : "s"}
          </div>
        </div>
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
              <th></th>
            </tr>
          </thead>
          <tbody>
            {pending.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">Nothing pending.</td>
              </tr>
            )}
            {pending.map((c) => (
              <tr key={c.id}>
                <td data-label="Date">{c.date}</td>
                <td data-label="Clinic">{CLINIC_LABEL[c.clinic]}</td>
                <td data-label="Patient ref">{c.patientRef}</td>
                <td data-label="Amount" className="num strong">{inr(c.amount)}</td>
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
