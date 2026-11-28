import { inr, monthLabel } from "@/lib/calc";
import { forecastNote, RELIABLE_MONTHS, type Estimate, type Forecast } from "@/lib/forecast";
import { CLINIC_LABEL } from "@/lib/types";
import { TrendChart } from "./TrendChart";
import { ChartsTableToggle } from "./ChartsTableToggle";

interface Props {
  combined: Forecast;
  /** Per-clinic forecasts; left out for the sample preview. */
  clinics?: { SDC1: Forecast; SDC2: Forecast };
  /** Combined profit of the months the estimate is based on, for the chart. */
  history: { month: string; profit: number }[];
  chartsOn: boolean;
  sample: boolean;
  currentMonth: string;
}

function Est({ e, sign = false }: { e?: Estimate; sign?: boolean }) {
  if (!e) return <span className="muted">–</span>;
  return (
    <>
      <span className={sign ? (e.value >= 0 ? "pos" : "neg") : ""}>{inr(e.value)}</span>
      <span className="range">
        {inr(e.low)} to {inr(e.high)}
      </span>
    </>
  );
}

export function ForecastSection({ combined, clinics, history, chartsOn, sample, currentMonth }: Props) {
  const label = (m: string) => (m === currentMonth ? `${monthLabel(m)} (this month, still running)` : monthLabel(m));
  const table = (
    <div className="table-wrap">
      <table className="stack forecast">
        <thead>
          <tr>
            <th>Month</th>
            {clinics && <th className="num">{CLINIC_LABEL.SDC1.split(" · ")[0]} profit</th>}
            {clinics && <th className="num">{CLINIC_LABEL.SDC2.split(" · ")[0]} profit</th>}
            <th className="num">Combined income</th>
            <th className="num">Combined expenses</th>
            <th className="num">Combined profit</th>
          </tr>
        </thead>
        <tbody>
          {combined.months.map((m, i) => (
            <tr key={m.month}>
              <td className="row-title">{sample ? "SAMPLE · " : "Estimate · "}{label(m.month)}</td>
              {clinics && (
                <td data-label="SDC 1 profit" className="num">
                  <Est e={clinics.SDC1.months[i]?.profit} sign />
                </td>
              )}
              {clinics && (
                <td data-label="SDC 2 profit" className="num">
                  <Est e={clinics.SDC2.months[i]?.profit} sign />
                </td>
              )}
              <td data-label="Combined income" className="num"><Est e={m.income} /></td>
              <td data-label="Combined expenses" className="num"><Est e={m.expenses} /></td>
              <td data-label="Combined profit" className="num"><Est e={m.profit} sign /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const months = [...history.map((h) => h.month), ...combined.months.map((m) => m.month)];
  const chart = (
    <TrendChart
      id="forecast-profit"
      title={`${sample ? "SAMPLE · " : ""}Combined profit: past months and estimate`}
      kind="bar"
      months={months}
      series={[
        { name: "Actual", color: "var(--series-sdc1)", values: [...history.map((h) => h.profit), ...combined.months.map(() => 0)] },
        { name: "Estimate", color: "var(--series-sdc2)", values: [...history.map(() => 0), ...combined.months.map((m) => m.profit.value)] },
      ]}
      notes={[...history.map(() => "Actual"), ...combined.months.map((m) => `Estimate, range ${inr(m.profit.low)} to ${inr(m.profit.high)}`)]}
    />
  );

  return (
    <>
      <h2>Forecast</h2>
      <p className={combined.reliable && !sample ? "muted" : "notice"}>
        {sample ? (
          <>
            <strong>SAMPLE DATA, not real.</strong> This forecast uses the invented sample months above.{" "}
          </>
        ) : (
          <strong>Estimate only. </strong>
        )}
        {forecastNote(combined)}
        {combined.basedOn.length > 0 && !sample && ` Months used: ${combined.basedOn.map(monthLabel).join(", ")}.`}
      </p>
      {combined.months.length === 0 ? null : chartsOn ? <ChartsTableToggle charts={chart} table={table} /> : table}
      <p className="muted">
        Each figure is the most likely amount, with the range from the lowest to the highest month used underneath. Estimates use the
        same income and expense rules as the cards above. Charts appear with more than {RELIABLE_MONTHS} months of data.
      </p>
    </>
  );
}
