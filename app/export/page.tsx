import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { getStore } from "@/lib/data/store";
import { getExtras } from "@/lib/data/extras";
import { inr, monthLabel, monthsIn } from "@/lib/calc";
import { financialYear, MAX_EXPORT_MONTHS, periodLabel, SCOPE_LABEL, summaryRows, type Scope } from "@/lib/accountant-export";
import { exportOptions } from "@/lib/export-params";
import { shiftMonth } from "@/lib/expense-view";
import { todayInIndia } from "@/lib/calc";

export const dynamic = "force-dynamic";

const SCOPES: Scope[] = ["ALL", "SDC1", "SDC2"];

export default async function ExportPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; clinic?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const extras = getExtras();
  const [d, gaps, counts] = await Promise.all([getStore().read(), extras.gapAnswers(), extras.pettyCounts()]);
  const { options, error } = exportOptions(d, sp);
  const months = monthsIn(d);
  const choices = [...new Set([...months, financialYear(months[months.length - 1]).from])].sort();
  const thisMonth = todayInIndia().slice(0, 7);
  const lastMonth = shiftMonth(thisMonth, -1);
  const fy = financialYear(lastMonth);
  const q = (o: { from: string; to: string; clinic: Scope }) => `from=${o.from}&to=${o.to}&clinic=${o.clinic}`;
  const query = q({ from: options.from, to: options.to, clinic: options.scope });
  const sum = summaryRows(d, options);
  const total = sum.reduce((s, r) => ({ income: s.income + r.income, expenses: s.expenses + r.expenses, profit: s.profit + r.profit }), { income: 0, expenses: 0, profit: 0 });

  return (
    <>
      <h1>Accountant export</h1>
      <p className="muted">The books for a month or a range, for one clinic or both, as an Excel file the accountant can work with.</p>

      <nav className="month-picker" aria-label="Quick picks">
        <Link href={`/export?${q({ from: lastMonth, to: lastMonth, clinic: options.scope })}`}>Last month ({monthLabel(lastMonth)})</Link>
        <Link href={`/export?${q({ from: thisMonth, to: thisMonth, clinic: options.scope })}`}>This month</Link>
        <Link href={`/export?${q({ from: fy.from, to: lastMonth < fy.to ? lastMonth : fy.to, clinic: options.scope })}`}>
          This financial year so far
        </Link>
      </nav>

      <form method="get" action="/export" className="card form-card">
        <label htmlFor="ex-from">From</label>
        <select id="ex-from" name="from" defaultValue={options.from}>
          {[...new Set([...choices, options.from])].sort().map((m) => (
            <option key={m} value={m}>{monthLabel(m)}</option>
          ))}
        </select>
        <label htmlFor="ex-to">To</label>
        <select id="ex-to" name="to" defaultValue={options.to}>
          {[...new Set([...choices, options.to])].sort().map((m) => (
            <option key={m} value={m}>{monthLabel(m)}</option>
          ))}
        </select>
        <label htmlFor="ex-clinic">Clinic</label>
        <select id="ex-clinic" name="clinic" defaultValue={options.scope}>
          {SCOPES.map((s) => (
            <option key={s} value={s}>{SCOPE_LABEL[s]}</option>
          ))}
        </select>
        <button type="submit" className="secondary full">Show this period</button>
        {error && <p className="err">{error}</p>}
        <p className="muted">Up to {MAX_EXPORT_MONTHS} months at a time.</p>
      </form>

      <div className="card">
        <div className="label strong">{SCOPE_LABEL[options.scope]} · {periodLabel(options)}</div>
        <p>
          Income {inr(total.income)} · Expenses {inr(total.expenses)} ·{" "}
          <span className={total.profit >= 0 ? "pos" : "neg"}>Profit {inr(total.profit)}</span>
        </p>
        <a className="button full" href={`/export/download?${query}`} download>
          Download Excel for the accountant
        </a>
        <Link className="button secondary full" href={`/export/print?${query}`}>
          Printable summary (save as PDF)
        </Link>
      </div>

      <h2>What the Excel file holds</h2>
      <ul>
        <li><strong>Summary</strong>: income by mode, expenses and profit per month, with totals.</li>
        <li><strong>Expenses by category</strong>: each category per month.</li>
        <li><strong>Expenses</strong>: every expense with who was paid, invoice number, and whether it was found in the bank statement. Bank payments nobody entered in the app are included too, marked as such.</li>
        <li><strong>Income by mode</strong>: PappyJoe cash, UPI and card per clinic.</li>
        <li><strong>Petty cash</strong>: opening, received, spent and expected balance per clinic{counts.ready ? ", with the month-end count" : ""}.</li>
        <li><strong>Reconciliation gaps</strong>: every gap with the reason given{gaps.ready ? "" : " (typed notes; per-item answers appear once that feature is switched on)"}.</li>
        <li><strong>Bank statement</strong>: every HDFC row in the period and what the app took it to be.</li>
      </ul>
      <p className="muted">Shared expenses are split 50/50 when one clinic is picked, as on the dashboard.</p>
    </>
  );
}
