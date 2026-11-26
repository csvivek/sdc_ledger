import { requireAdmin } from "@/lib/auth";
import { getStore } from "@/lib/data/store";
import { expensesByCategory, inr, monthLabel, monthsIn, pnl, SHARED_SPLIT } from "@/lib/calc";
import { CLINIC_LABEL } from "@/lib/types";
import { MonthPicker, pickMonth } from "@/components/MonthPicker";
import { resetDemoData } from "../actions";

export const dynamic = "force-dynamic";

const SCOPES = [
  ["SDC1", CLINIC_LABEL.SDC1],
  ["SDC2", CLINIC_LABEL.SDC2],
  ["ALL", "Combined"],
] as const;

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  await requireAdmin();
  const d = await getStore().read();
  const months = monthsIn(d);
  const month = pickMonth(months, (await searchParams).month);
  const cats = expensesByCategory(d, month);
  const maxCat = Math.max(1, ...cats.map(([, v]) => v));
  const pendingCard = d.cardPayments.filter((c) => !c.creditedOn).reduce((s, c) => s + c.amount, 0);

  return (
    <>
      <h1>Dashboard</h1>
      <MonthPicker months={months} active={month} basePath="/dashboard" />

      <div className="grid">
        {SCOPES.map(([k, label]) => {
          const p = pnl(d, month, k);
          return (
            <div key={k} className="card stat">
              <div className="label">{label}</div>
              <div className={`value ${p.profit >= 0 ? "pos" : "neg"}`}>{inr(p.profit)}</div>
              <div className="muted">
                Income {inr(p.income)} · Expenses {inr(p.expenses)}
              </div>
            </div>
          );
        })}
      </div>
      {pendingCard > 0 && (
        <p className="mock-note">
          {inr(pendingCard)} of card income is still with the doctor. <a href="/card-income">See card income</a>
        </p>
      )}
      <p className="muted">
        Income is PappyJoe cash + UPI + card. Expenses exclude petty cash withdrawals, which are transfers. Shared expenses are split{" "}
        {SHARED_SPLIT.SDC1 * 100}/{SHARED_SPLIT.SDC2 * 100} between clinics (mock rule, to confirm).
      </p>

      <h2>Monthly trend</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Month</th>
              {SCOPES.map(([k, label]) => (
                <th key={k} className="num" colSpan={1}>
                  {label.split(" · ")[0]} profit
                </th>
              ))}
              <th className="num">Combined income</th>
              <th className="num">Combined expenses</th>
            </tr>
          </thead>
          <tbody>
            {months.map((m) => {
              const all = pnl(d, m, "ALL");
              return (
                <tr key={m}>
                  <td>{monthLabel(m)}</td>
                  {SCOPES.map(([k]) => {
                    const p = pnl(d, m, k).profit;
                    return (
                      <td key={k} className={`num ${p >= 0 ? "pos" : "neg"}`}>
                        {inr(p)}
                      </td>
                    );
                  })}
                  <td className="num">{inr(all.income)}</td>
                  <td className="num">{inr(all.expenses)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h2>Expenses by category, {monthLabel(month)} (both clinics)</h2>
      <div className="card">
        {cats.map(([c, v]) => (
          <div key={c} className="bar-row">
            <span>{c}</span>
            <div className="bar" style={{ width: `${(v / maxCat) * 100}%` }} />
            <span style={{ textAlign: "right" }}>{inr(v)}</span>
          </div>
        ))}
      </div>

      <form action={resetDemoData} style={{ marginTop: 24 }}>
        <button type="submit" className="secondary small">Reset demo data</button>{" "}
        <span className="muted">Puts the fake seed data back and removes anything entered.</span>
      </form>
    </>
  );
}
