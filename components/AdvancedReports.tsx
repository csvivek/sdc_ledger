import Link from "next/link";
import { inr, monthLabel } from "@/lib/calc";
import {
  NOT_ASSIGNED,
  payeeRanking,
  PERIOD_LABEL,
  REPORT_KINDS,
  REPORT_TITLE,
  type PayeeRanking,
  type ReportPeriod,
  type ReportScope,
} from "@/lib/payee-report";
import { addMonths } from "@/lib/trend";
import { CLINIC_LABEL, type LedgerData } from "@/lib/types";
import { ChartsTableToggle } from "./ChartsTableToggle";

const SCOPE_LABEL: Record<ReportScope, string> = { ALL: "Both clinics", SDC1: CLINIC_LABEL.SDC1.split(" · ")[0], SDC2: CLINIC_LABEL.SDC2.split(" · ")[0] };
const ONE = { consultant: "Consultant", lab: "Lab", pharma: "Pharma company" } as const;
const PERIODS: ReportPeriod[] = ["month", "12m", "all"];
const SCOPES: ReportScope[] = ["ALL", "SDC1", "SDC2"];

/**
 * Advanced reports, closed until clicked: which consultant, lab and pharma company was paid the most.
 * Settings live in the address (rp = period, rc = clinic) so the page stays plain server HTML.
 */
export function AdvancedReports({
  d,
  month,
  period,
  scope,
  open,
}: {
  d: LedgerData;
  month: string;
  period: ReportPeriod;
  scope: ReportScope;
  open: boolean;
}) {
  const href = (p: ReportPeriod, s: ReportScope) => `/reports?month=${month}&rp=${p}&rc=${s}#advanced`;
  const spanText =
    period === "month" ? monthLabel(month) : period === "12m" ? `${monthLabel(addMonths(month, -11))} to ${monthLabel(month)}` : "every month on record";

  return (
    <details id="advanced" className="card advanced" open={open}>
      <summary>Advanced reports: who was paid the most</summary>
      <p className="muted">
        Consultants, labs and pharma companies ranked by money paid, for {scope === "ALL" ? "both clinics" : SCOPE_LABEL[scope]}, {spanText}.
        Portal entries use the payee chosen on the form. Bank payments nobody entered in the portal use the name on the bank statement,
        matched to your payee list; a name not on the list is marked <em>from bank</em>. Payments with no name are under {NOT_ASSIGNED}, so
        each total matches its category. Shared payments are split 50/50 when one clinic is chosen.
      </p>

      <div className="report-filters">
        <div className="month-picker" role="group" aria-label="Period">
          {PERIODS.map((p) => (
            <Link key={p} href={href(p, scope)} className={p === period ? "active" : ""} scroll={false}>
              {PERIOD_LABEL[p]}
            </Link>
          ))}
        </div>
        <div className="month-picker" role="group" aria-label="Clinic">
          {SCOPES.map((s) => (
            <Link key={s} href={href(period, s)} className={s === scope ? "active" : ""} scroll={false}>
              {SCOPE_LABEL[s]}
            </Link>
          ))}
        </div>
      </div>

      {REPORT_KINDS.map((k) => {
        const r = payeeRanking(d, k, period, month, scope);
        return (
          <section key={k} className="report-block">
            <h3 className="sub">
              {REPORT_TITLE[k]}{" "}
              <span className="muted">
                {inr(r.total)} · {r.payments} payment{r.payments === 1 ? "" : "s"}
              </span>
            </h3>
            {r.rows.length === 0 ? (
              <p className="muted">No {REPORT_TITLE[k].toLowerCase()} payments in this period.</p>
            ) : (
              <ChartsTableToggle charts={<RankBars r={r} />} table={<RankTable r={r} />} />
            )}
          </section>
        );
      })}
    </details>
  );
}

const dayLabel = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

function Name({ row }: { row: PayeeRanking["rows"][number] }) {
  return (
    <>
      {row.name}
      {row.source === "bank" && <span className="tag">from bank</span>}
    </>
  );
}

function RankBars({ r }: { r: PayeeRanking }) {
  const max = Math.max(1, ...r.rows.map((x) => x.amount));
  return (
    <div role="list" aria-label={`${REPORT_TITLE[r.kind]}, most paid first`}>
      {r.rows.map((x) => (
        <div key={`${x.source}-${x.name}`} className={`bar-row rank ${x.source === "none" ? "unassigned" : ""}`} role="listitem">
          <span className="bar-label">
            <Name row={x} />
          </span>
          <div className="bar-track">
            <div className="bar" style={{ width: `${(x.amount / max) * 100}%` }} />
          </div>
          <span className="bar-value">
            {inr(x.amount)} <small className="muted">{Math.round(x.share)}%</small>
          </span>
        </div>
      ))}
    </div>
  );
}

function RankTable({ r }: { r: PayeeRanking }) {
  return (
    <div className="table-wrap">
      <table className="stack">
        <thead>
          <tr>
            <th>{ONE[r.kind]}</th>
            <th className="num">Paid</th>
            <th className="num">Share</th>
            <th className="num">Payments</th>
            <th className="num">Last paid</th>
          </tr>
        </thead>
        <tbody>
          {r.rows.map((x) => (
            <tr key={`${x.source}-${x.name}`}>
              <td className="row-title">
                <Name row={x} />
              </td>
              <td data-label="Paid" className="num">{inr(x.amount)}</td>
              <td data-label="Share" className="num">{Math.round(x.share)}%</td>
              <td data-label="Payments" className="num">{x.payments}</td>
              <td data-label="Last paid" className="num">{dayLabel(x.lastPaid)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
