import { inr, monthLabel } from "@/lib/calc";
import {
  analyticsRows,
  MODE_LABEL,
  MODES,
  modeShare,
  previewAnalyticsRows,
  receiptMonths,
  type AnalyticsRow,
  type Scope,
} from "@/lib/analytics";
import { CHART_THRESHOLD_MONTHS, shouldShowCharts } from "@/lib/trend";
import { CLINIC_LABEL, type PjReceipt } from "@/lib/types";
import { ChartsTableToggle } from "./ChartsTableToggle";
import { TrendChart } from "./TrendChart";
import { CardMachineCost } from "./CardMachineCost";

const SCOPE_LABEL: Record<Scope, string> = { SDC1: CLINIC_LABEL.SDC1, SDC2: CLINIC_LABEL.SDC2, ALL: "Both clinics" };
const short = (s: Scope) => SCOPE_LABEL[s].split(" · ")[0];
const one = (n: number) => (Math.round(n * 10) / 10).toString();

/**
 * Patients, visits, revenue per patient, payment modes and card money, from the PappyJoe payments import.
 * Tables of real numbers show from the first month; charts once there are more than 6 months of PappyJoe data.
 * Aggregates only: no patient names, ids or phone numbers reach the page.
 */
export function AnalyticsSection({ receipts, preview, latestMonth }: { receipts: PjReceipt[]; preview: boolean; latestMonth: string }) {
  const realMonths = receiptMonths(receipts);
  const monthsOfData = realMonths.length;
  const chartsOn = preview || shouldShowCharts(monthsOfData);
  const rows = preview ? previewAnalyticsRows(realMonths[realMonths.length - 1] ?? latestMonth) : analyticsRows(receipts, realMonths);
  const months = [...new Set(rows.map((r) => r.month))];
  const cardRows = byScope(rows, "ALL", months).map((r) => ({ month: r.month, count: r.modes.CARD.count, amount: r.modes.CARD.amount }));
  const remaining = CHART_THRESHOLD_MONTHS + 1 - monthsOfData;

  return (
    <>
      <h2>Patients and payments</h2>
      {preview && (
        <p className="mock-note">
          <strong>SAMPLE DATA, not real.</strong> Everything in Patients and payments and Card machine below uses invented numbers so you
          can see how the charts will look. Real charts appear automatically once there are more than {CHART_THRESHOLD_MONTHS} months of
          PappyJoe payments (there {monthsOfData === 1 ? "is" : "are"} {monthsOfData} now). <a href="/reports">Back to real numbers</a>
        </p>
      )}
      {!preview && monthsOfData === 0 ? (
        <p className="muted">Import PappyJoe payments on the Import page to see patients, revenue per patient and payment modes here.</p>
      ) : (
        <>
          <p className="muted">
            From the PappyJoe payments import. A patient is someone who paid that month. A paying visit is one patient paying on one day, so
            visits with no payment are not counted. Revenue includes PappyJoe&apos;s negative corrections, so it matches Income above.
          </p>
          {chartsOn ? (
            <ChartsTableToggle
              charts={<AnalyticsCharts rows={rows} months={months} sample={preview} monthsOfData={monthsOfData} />}
              table={<AnalyticsTables rows={rows} />}
            />
          ) : (
            <>
              <p className="muted">
                <strong>Real numbers.</strong> Charts appear automatically once there are more than {CHART_THRESHOLD_MONTHS} months of
                PappyJoe payments. There {monthsOfData === 1 ? "is" : "are"} {monthsOfData} month{monthsOfData === 1 ? "" : "s"} now, so they
                start after {remaining} more month{remaining === 1 ? "" : "s"}. <a href="/reports?preview=charts">Preview the charts with sample data</a>
              </p>
              <AnalyticsTables rows={rows} />
            </>
          )}

          <h2>Card machine</h2>
          <CardMachineCost rows={cardRows} showChart={chartsOn} sample={preview} />
        </>
      )}
    </>
  );
}

function byScope(rows: AnalyticsRow[], s: Scope, months: string[]): AnalyticsRow[] {
  return months.map((m) => rows.find((r) => r.month === m && r.scope === s)!);
}

function AnalyticsCharts({ rows, months: ms, sample, monthsOfData: n }: { rows: AnalyticsRow[]; months: string[]; sample: boolean; monthsOfData: number }) {
  const t = (title: string) => (sample ? `SAMPLE · ${title}` : title);
  const s1 = byScope(rows, "SDC1", ms);
  const s2 = byScope(rows, "SDC2", ms);
  const all = byScope(rows, "ALL", ms);
  const clinics = (pick: (r: AnalyticsRow) => number) => [
    { name: CLINIC_LABEL.SDC1, color: "var(--series-sdc1)", values: s1.map(pick) },
    { name: CLINIC_LABEL.SDC2, color: "var(--series-sdc2)", values: s2.map(pick) },
  ];
  return (
    <>
      <p className="muted">
        {sample ? <strong>Sample data.</strong> : <strong>Real numbers from {n} months of PappyJoe payments.</strong>} Each chart shows the latest 12
        months; switch it to All for older months, or tick vs last year to compare with the same month a year before. Tap a month
        to see its numbers.
      </p>
      <div className="chart-grid">
        <TrendChart id="an-patients" title={t("Patients per month")} kind="bar" format="count" months={ms} series={clinics((r) => r.patients)} notes={all.map((r) => `Both clinics ${r.patients} patients, ${r.visits} paying visits`)} />
        <TrendChart id="an-visits" title={t("Paying visits per day")} kind="line" format="decimal" months={ms} series={clinics((r) => r.visitsPerDay)} />
        <TrendChart id="an-perpatient" title={t("Revenue per patient")} kind="line" months={ms} series={clinics((r) => r.perPatient)} notes={all.map((r) => `Per visit, both clinics ${inr(r.perVisit)}`)} />
        <TrendChart
          id="an-modes"
          title={t("How patients pay, both clinics")}
          kind="bar"
          months={ms}
          series={[
            { name: "Cash", color: "var(--series-cash)", values: all.map((r) => r.modes.CASH.amount) },
            { name: "UPI", color: "var(--series-upi)", values: all.map((r) => r.modes.UPI.amount) },
            { name: "Card", color: "var(--series-card)", values: all.map((r) => r.modes.CARD.amount) },
          ]}
          notes={all.map((r) => `UPI ${Math.round(modeShare(r, "UPI", "amount"))}% of the money, cash ${Math.round(modeShare(r, "CASH", "amount"))}%`)}
        />
      </div>
    </>
  );
}

function AnalyticsTables({ rows }: { rows: AnalyticsRow[] }) {
  const modes = MODES.filter((m) => m !== "OTHER" || rows.some((r) => r.modes.OTHER.count || r.modes.OTHER.amount));
  return (
    <>
      <h3 className="sub">Patients and revenue</h3>
      <div className="table-wrap">
        <table className="stack">
          <thead>
            <tr>
              <th>Month</th>
              <th className="num">Patients</th>
              <th className="num">Paying visits</th>
              <th className="num">Visits per day</th>
              <th className="num">Revenue</th>
              <th className="num">Per patient</th>
              <th className="num">Per visit</th>
              <th className="num">Corrections</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.month}-${r.scope}`}>
                <td className="row-title">{monthLabel(r.month)} · {short(r.scope)}</td>
                <td data-label="Patients" className="num">{r.patients}</td>
                <td data-label="Paying visits" className="num">{r.visits}</td>
                <td data-label="Visits per day" className="num">{one(r.visitsPerDay)}</td>
                <td data-label="Revenue" className="num">{inr(r.revenue)}</td>
                <td data-label="Per patient" className="num">{inr(r.perPatient)}</td>
                <td data-label="Per visit" className="num">{inr(r.perVisit)}</td>
                <td data-label="Corrections" className={`num ${r.corrections ? "neg" : ""}`}>
                  {r.correctionLines ? `${inr(r.corrections)} (${r.correctionLines})` : "None"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="sub">How patients pay</h3>
      <p className="muted">Money in each mode, with the number of payments and the share of the month&apos;s money.</p>
      <div className="table-wrap">
        <table className="stack">
          <thead>
            <tr>
              <th>Month</th>
              {modes.map((m) => (
                <th key={m} className="num">{MODE_LABEL[m]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.month}-${r.scope}`}>
                <td className="row-title">{monthLabel(r.month)} · {short(r.scope)}</td>
                {modes.map((m) => (
                  <td key={m} data-label={MODE_LABEL[m]} className="num mode-cell">
                    {inr(r.modes[m].amount)}
                    <small>
                      {r.modes[m].count} payment{r.modes[m].count === 1 ? "" : "s"} · {Math.round(modeShare(r, m, "amount"))}%
                    </small>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
