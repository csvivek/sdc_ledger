import { requireAdmin } from "@/lib/auth";
import { getStore } from "@/lib/data/store";
import { inr, monthLabel, monthsIn, reconciliation } from "@/lib/calc";
import { CLINIC_LABEL } from "@/lib/types";
import { MonthPicker, pickMonth } from "@/components/MonthPicker";
import { saveReconReason } from "../actions";

export const dynamic = "force-dynamic";

export default async function ReconciliationPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  await requireAdmin();
  const d = await getStore().read();
  const months = monthsIn(d);
  const month = pickMonth(months, (await searchParams).month);
  const rows = reconciliation(d, month);
  const openCount = months.flatMap((m) => reconciliation(d, m)).filter((r) => r.gap !== 0 && !r.reason).length;

  return (
    <>
      <h1>Reconcile PappyJoe with bank</h1>
      <p className="muted">
        PappyJoe cash and UPI for the month, compared with deposits into the HDFC account for that clinic. Cash goes in as
        several lumps, so we match the month&apos;s total, not each payment.
      </p>
      <p className="mock-note">
        Mock: PappyJoe totals and bank deposits are seed data, and each deposit is already tagged to a clinic. Real data will come
        from file uploads. Weekly view is not built yet.
      </p>
      {openCount > 0 && (
        <p>
          <span className="badge open">{openCount} unexplained gap{openCount > 1 ? "s" : ""}</span> across all months
        </p>
      )}
      <MonthPicker months={months} active={month} basePath="/reconciliation" />

      {rows.map((r) => {
        const status = r.gap === 0 ? "Matched" : r.reason ? "Explained" : "Needs a reason";
        return (
          <div key={r.clinic} className="card">
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              <strong>
                {CLINIC_LABEL[r.clinic]} · {monthLabel(month)}
              </strong>
              <span className={`badge ${status === "Needs a reason" ? "open" : "done"}`}>{status}</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th></th>
                    <th className="num">PappyJoe</th>
                    <th className="num">Bank</th>
                    <th className="num">Gap</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Cash</td>
                    <td className="num">{inr(r.pjCash)}</td>
                    <td className="num">{inr(r.bankCash)}</td>
                    <td className={`num ${r.pjCash - r.bankCash ? "neg" : ""}`}>{inr(r.pjCash - r.bankCash)}</td>
                  </tr>
                  <tr>
                    <td>UPI</td>
                    <td className="num">{inr(r.pjUpi)}</td>
                    <td className="num">{inr(r.bankUpi)}</td>
                    <td className={`num ${r.pjUpi - r.bankUpi ? "neg" : ""}`}>{inr(r.pjUpi - r.bankUpi)}</td>
                  </tr>
                  <tr>
                    <td><strong>Total</strong></td>
                    <td className="num"><strong>{inr(r.pjCash + r.pjUpi)}</strong></td>
                    <td className="num"><strong>{inr(r.bankCash + r.bankUpi)}</strong></td>
                    <td className={`num ${r.gap ? "neg" : ""}`}><strong>{inr(r.gap)}</strong></td>
                  </tr>
                </tbody>
              </table>
            </div>
            {r.gap !== 0 && (
              <form action={saveReconReason} className="recon-form">
                <input type="hidden" name="month" value={month} />
                <input type="hidden" name="clinic" value={r.clinic} />
                <input
                  name="reason"
                  defaultValue={r.reason}
                  placeholder="Reason, e.g. cash used for expenses, deposit not yet made"
                  aria-label="Reason for the gap"
                />
                <button type="submit" className="small">Save</button>
              </form>
            )}
          </div>
        );
      })}
    </>
  );
}
