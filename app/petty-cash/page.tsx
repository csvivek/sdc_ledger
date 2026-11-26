import { requireAdmin } from "@/lib/auth";
import { getStore } from "@/lib/data/store";
import { inr, pettyCash } from "@/lib/calc";
import { CLINICS, CLINIC_LABEL } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function PettyCashPage() {
  await requireAdmin();
  const d = await getStore().read();

  return (
    <>
      <h1>Petty cash</h1>
      <p className="muted">
        The doctor&apos;s two monthly withdrawals (one per clinic) move money from the bank into each clinic&apos;s petty cash.
        They are transfers, not expenses. Expenses paid from petty cash reduce the balance.
      </p>
      <p className="muted">Transfers marked PETTY CASH in the imported HDFC statement are split equally between the clinics.</p>

      <div className="grid">
        {CLINICS.map((c) => {
          const p = pettyCash(d, c);
          return (
            <div key={c} className="card stat">
              <div className="label">{CLINIC_LABEL[c]}</div>
              <div className={`value ${p.balance < 0 ? "neg" : ""}`}>{inr(p.balance)}</div>
              <div className="muted">
                Opening {inr(p.opening)} + withdrawals {inr(p.totalIn)} − spent {inr(p.totalOut)}
              </div>
            </div>
          );
        })}
      </div>

      {CLINICS.map((c) => {
        const p = pettyCash(d, c);
        const rows = [
          ...p.transfersIn.map((t) => ({ date: t.date, what: t.note, inAmt: t.amount, outAmt: 0, key: t.id })),
          ...p.spent.map((e) => ({ date: e.date, what: `${e.category}: ${e.note}`, inAmt: 0, outAmt: e.amount, key: e.id })),
        ].sort((a, b) => b.date.localeCompare(a.date) || b.inAmt - a.inAmt);
        return (
          <section key={c}>
            <h2>{CLINIC_LABEL[c]}: movements</h2>
            <div className="table-wrap">
              <table className="stack">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>What</th>
                    <th className="num">In (transfer)</th>
                    <th className="num">Out (expense)</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={4} className="muted">No movements yet.</td>
                    </tr>
                  )}
                  {rows.map((r) => (
                    <tr key={r.key}>
                      <td data-label="Date">{r.date}</td>
                      <td data-label="What" className="wrap">{r.what}</td>
                      <td data-label="In (transfer)" className="num pos">{r.inAmt ? inr(r.inAmt) : ""}</td>
                      <td data-label="Out (expense)" className="num">{r.outAmt ? inr(r.outAmt) : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </>
  );
}
