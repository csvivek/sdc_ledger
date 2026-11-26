import { requireAdmin } from "@/lib/auth";
import { getStore } from "@/lib/data/store";
import { cardDaysOverdue, expensesByCategory, inr, monthLabel, monthsIn, pnl, SHARED_SPLIT, todayInIndia } from "@/lib/calc";
import { CLINIC_LABEL } from "@/lib/types";
import { MonthPicker, pickMonth } from "@/components/MonthPicker";
import { isSupabaseConfigured } from "@/lib/supabase/config";
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
  const pendingCards = d.cardPayments.filter((c) => !c.creditedOn);
  const pendingCard = pendingCards.reduce((s, c) => s + c.amount, 0);
  const today = todayInIndia();
  const overdueCard = pendingCards.filter((c) => cardDaysOverdue(c.date, today) > 0).reduce((s, c) => s + c.amount, 0);

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
          {inr(pendingCard)} of card income is still with the doctor
          {overdueCard > 0 ? `, and ${inr(overdueCard)} of it is overdue from earlier months` : ""}. <a href="/card-income">See card income</a>
        </p>
      )}
      <p className="muted">
        Income is PappyJoe cash + UPI + card. Expenses are portal entries plus categorised bank payments nobody entered in the portal; petty cash withdrawals are transfers, not expenses, and bank payments still waiting for an answer on Import are left out. Shared expenses are split{" "}
        {SHARED_SPLIT.SDC1 * 100}/{SHARED_SPLIT.SDC2 * 100} between clinics (mock rule, to confirm).
      </p>

      <h2>Monthly trend</h2>
      <div className="table-wrap">
        <table className="stack">
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
                  <td className="row-title">{monthLabel(m)}</td>
                  {SCOPES.map(([k, label]) => {
                    const p = pnl(d, m, k).profit;
                    return (
                      <td key={k} data-label={`${label.split(" · ")[0]} profit`} className={`num ${p >= 0 ? "pos" : "neg"}`}>
                        {inr(p)}
                      </td>
                    );
                  })}
                  <td data-label="Combined income" className="num">{inr(all.income)}</td>
                  <td data-label="Combined expenses" className="num">{inr(all.expenses)}</td>
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
            <span className="bar-label">{c}</span>
            <div className="bar-track"><div className="bar" style={{ width: `${(v / maxCat) * 100}%` }} /></div>
            <span className="bar-value">{inr(v)}</span>
          </div>
        ))}
      </div>

      {!isSupabaseConfigured && (
        <form action={resetDemoData} style={{ marginTop: 24 }}>
          <button type="submit" className="secondary small">Reset demo data</button>{" "}
          <span className="muted">Puts the fake seed data back and removes anything entered.</span>
        </form>
      )}
    </>
  );
}
