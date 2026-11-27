import { requireAdmin } from "@/lib/auth";
import { getStore } from "@/lib/data/store";
import { cardDaysOverdue, expensesByCategory, inr, monthLabel, monthsIn, monthsWithData, pnl, SHARED_SPLIT, todayInIndia } from "@/lib/calc";
import { CHART_THRESHOLD_MONTHS, CHART_WINDOW_MONTHS, previewTrendRows, shouldShowCharts, trendRows, type TrendRow } from "@/lib/trend";
import { TrendChart } from "@/components/TrendChart";
import { ChartsTableToggle } from "@/components/ChartsTableToggle";
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

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ month?: string; preview?: string }> }) {
  await requireAdmin();
  const d = await getStore().read();
  const months = monthsIn(d);
  const params = await searchParams;
  const month = pickMonth(months, params.month);
  const monthsOfData = monthsWithData(d).length;
  // ?preview=charts shows the charts with invented sample numbers, so they can be checked before 7 real months exist.
  const preview = params.preview === "charts";
  const chartsOn = preview || shouldShowCharts(monthsOfData);
  const rows = preview ? previewTrendRows(months[months.length - 1]) : trendRows(d, months);
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
      {preview && (
        <p className="mock-note">
          Sample numbers to preview the charts. These are not the clinics&apos; figures. <a href="/dashboard">Back to real numbers</a>
        </p>
      )}
      {chartsOn ? (
        <ChartsTableToggle charts={<TrendCharts rows={rows.slice(-CHART_WINDOW_MONTHS)} />} table={<TrendTables rows={rows} />} />
      ) : (
        <>
          <p className="muted">
            Charts appear once there are more than {CHART_THRESHOLD_MONTHS} months of data (there {monthsOfData === 1 ? "is" : "are"} {monthsOfData} now).{" "}
            <a href="/dashboard?preview=charts">Preview them with sample numbers</a>
          </p>
          <TrendTable rows={rows} />
        </>
      )}

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

const short = (label: string) => label.split(" · ")[0];

function TrendCharts({ rows }: { rows: TrendRow[] }) {
  const months = rows.map((r) => r.month);
  return (
    <>
      <p className="muted">
        Last {rows.length} months. Tap a month to see its numbers, or switch to Table for every month.
      </p>
      <div className="chart-grid">
        <TrendChart
          title="Income and expenses, both clinics"
          kind="bar"
          months={months}
          series={[
            { name: "Income", color: "var(--series-income)", values: rows.map((r) => r.income) },
            { name: "Expenses", color: "var(--series-expenses)", values: rows.map((r) => r.expenses) },
          ]}
          notes={rows.map((r) => `Profit ${inr(r.profit.ALL)}`)}
        />
        <TrendChart
          title="Profit by clinic"
          kind="line"
          months={months}
          series={[
            { name: CLINIC_LABEL.SDC1, color: "var(--series-sdc1)", values: rows.map((r) => r.profit.SDC1) },
            { name: CLINIC_LABEL.SDC2, color: "var(--series-sdc2)", values: rows.map((r) => r.profit.SDC2) },
          ]}
        />
        <TrendChart
          title="Cash collected, not yet deposited"
          kind="bar"
          months={months}
          series={[{ name: "Not deposited", color: "var(--brand)", values: rows.map((r) => r.cashNotDeposited) }]}
        />
        <TrendChart
          title="UPI in PappyJoe, not in bank"
          kind="bar"
          months={months}
          series={[{ name: "Difference", color: "var(--brand)", values: rows.map((r) => r.upiGap) }]}
        />
      </div>
    </>
  );
}

function TrendTables({ rows }: { rows: TrendRow[] }) {
  return (
    <>
      <TrendTable rows={rows} />
      <h3 className="sub">Reconciliation gaps by month</h3>
      <div className="table-wrap">
        <table className="stack">
          <thead>
            <tr>
              <th>Month</th>
              <th className="num">Cash not yet deposited</th>
              <th className="num">UPI in PappyJoe, not in bank</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.month}>
                <td className="row-title">{monthLabel(r.month)}</td>
                <td data-label="Cash not yet deposited" className={`num ${Math.round(r.cashNotDeposited) ? "neg" : ""}`}>{inr(r.cashNotDeposited)}</td>
                <td data-label="UPI in PappyJoe, not in bank" className={`num ${Math.round(r.upiGap) ? "neg" : ""}`}>{inr(r.upiGap)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function TrendTable({ rows }: { rows: TrendRow[] }) {
  return (
    <div className="table-wrap">
      <table className="stack">
        <thead>
          <tr>
            <th>Month</th>
            {SCOPES.map(([k, label]) => (
              <th key={k} className="num">
                {short(label)} profit
              </th>
            ))}
            <th className="num">Combined income</th>
            <th className="num">Combined expenses</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.month}>
              <td className="row-title">{monthLabel(r.month)}</td>
              {SCOPES.map(([k, label]) => {
                const p = r.profit[k];
                return (
                  <td key={k} data-label={`${short(label)} profit`} className={`num ${p >= 0 ? "pos" : "neg"}`}>
                    {inr(p)}
                  </td>
                );
              })}
              <td data-label="Combined income" className="num">{inr(r.income)}</td>
              <td data-label="Combined expenses" className="num">{inr(r.expenses)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
