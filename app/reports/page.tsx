import { requireAdmin } from "@/lib/auth";
import { getStore } from "@/lib/data/store";
import { expensesByCategory, inr, monthLabel, monthsIn, monthsWithData } from "@/lib/calc";
import { CHART_THRESHOLD_MONTHS, previewTrendRows, shouldShowCharts, trendRows, type TrendRow } from "@/lib/trend";
import { TrendChart } from "@/components/TrendChart";
import { ChartsTableToggle } from "@/components/ChartsTableToggle";
import { AnalyticsSection } from "@/components/AnalyticsSection";
import { AdvancedReports } from "@/components/AdvancedReports";
import { parsePeriod, parseScope } from "@/lib/payee-report";
import { CLINIC_LABEL } from "@/lib/types";
import { MonthPicker, pickMonth } from "@/components/MonthPicker";

export const dynamic = "force-dynamic";

const SCOPES = [
  ["SDC1", CLINIC_LABEL.SDC1],
  ["SDC2", CLINIC_LABEL.SDC2],
  ["ALL", "Combined"],
] as const;

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ month?: string; preview?: string; rp?: string; rc?: string }> }) {
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

  return (
    <>
      <h1>Reports</h1>

      <h2>Monthly trend</h2>
      {preview && (
        <p className="mock-note">
          <strong>SAMPLE DATA, not real.</strong> The charts and table in this Monthly trend section use invented numbers so you can
          see how they will look. Real charts appear automatically once there are more than {CHART_THRESHOLD_MONTHS} months of data
          (there {monthsOfData === 1 ? "is" : "are"} {monthsOfData} now). <a href="/reports">Back to real numbers</a>
        </p>
      )}
      {chartsOn ? (
        <ChartsTableToggle charts={<TrendCharts rows={rows} sample={preview} monthsOfData={monthsOfData} />} table={<TrendTables rows={rows} />} />
      ) : (
        <>
          <p className="muted">
            <strong>Real numbers.</strong> Charts of real data appear automatically once there are more than {CHART_THRESHOLD_MONTHS}{" "}
            months of data. There {monthsOfData === 1 ? "is" : "are"} {monthsOfData} month{monthsOfData === 1 ? "" : "s"} now, so they
            start after {CHART_THRESHOLD_MONTHS + 1 - monthsOfData} more month{CHART_THRESHOLD_MONTHS + 1 - monthsOfData === 1 ? "" : "s"} of data.{" "}
            <a href="/reports?preview=charts">Preview the charts with sample data</a>
          </p>
          <TrendTable rows={rows} />
        </>
      )}

      <AnalyticsSection receipts={d.pjReceipts} preview={preview} latestMonth={months[months.length - 1]} />

      <h2>Expenses by category, {monthLabel(month)} (both clinics)</h2>
      <MonthPicker months={months} active={month} basePath="/reports" />
      <div className="card">
        {cats.length === 0 && <p className="muted">No expenses in {monthLabel(month)}.</p>}
        {cats.map(([c, v]) => (
          <div key={c} className="bar-row">
            <span className="bar-label">{c}</span>
            <div className="bar-track"><div className="bar" style={{ width: `${(v / maxCat) * 100}%` }} /></div>
            <span className="bar-value">{inr(v)}</span>
          </div>
        ))}
      </div>

      <AdvancedReports d={d} month={month} period={parsePeriod(params.rp)} scope={parseScope(params.rc)} open={Boolean(params.rp || params.rc)} />
    </>
  );
}

const short = (label: string) => label.split(" · ")[0];

function TrendCharts({ rows, sample, monthsOfData }: { rows: TrendRow[]; sample: boolean; monthsOfData: number }) {
  const months = rows.map((r) => r.month);
  const t = (title: string) => (sample ? `SAMPLE · ${title}` : title);
  return (
    <>
      <p className="muted">
        {sample ? <strong>Sample data.</strong> : <strong>Real numbers from {monthsOfData} months of data.</strong>} Each chart shows the latest 12 months; switch it to All for older months, or tick vs last year to compare each month with the same month a year before. Tap a month to see its numbers.
      </p>
      <div className="chart-grid">
        <TrendChart
          id="trend-income"
          title={t("Income and expenses, both clinics")}
          kind="bar"
          months={months}
          series={[
            { name: "Income", color: "var(--series-income)", values: rows.map((r) => r.income) },
            { name: "Expenses", color: "var(--series-expenses)", values: rows.map((r) => r.expenses) },
          ]}
          notes={rows.map((r) => `Profit ${inr(r.profit.ALL)}`)}
        />
        <TrendChart
          id="trend-profit"
          title={t("Profit by clinic")}
          kind="line"
          months={months}
          series={[
            { name: CLINIC_LABEL.SDC1, color: "var(--series-sdc1)", values: rows.map((r) => r.profit.SDC1) },
            { name: CLINIC_LABEL.SDC2, color: "var(--series-sdc2)", values: rows.map((r) => r.profit.SDC2) },
          ]}
        />
        <TrendChart
          id="trend-cash"
          title={t("Cash collected, not yet deposited")}
          kind="bar"
          months={months}
          series={[{ name: "Not deposited", color: "var(--brand)", values: rows.map((r) => r.cashNotDeposited) }]}
        />
        <TrendChart
          id="trend-upi"
          title={t("UPI in PappyJoe, not in bank")}
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
