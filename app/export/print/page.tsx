import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { getStore } from "@/lib/data/store";
import { getExtras } from "@/lib/data/extras";
import { inr, monthLabel } from "@/lib/calc";
import { categoryTable, gapRows, periodLabel, pettyRows, SCOPE_LABEL, summaryRows } from "@/lib/accountant-export";
import { exportOptions } from "@/lib/export-params";
import { PrintButton } from "@/components/PrintButton";

export const dynamic = "force-dynamic";

export default async function ExportPrintPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; clinic?: string }> }) {
  const user = await requireAdmin();
  const sp = await searchParams;
  const extras = getExtras();
  const [d, gaps, counts] = await Promise.all([getStore().read(), extras.gapAnswers(), extras.pettyCounts()]);
  const { options: o } = exportOptions(d, sp);
  const sum = summaryRows(d, o);
  const cat = categoryTable(d, o);
  const petty = pettyRows(d, o, counts.ready ? counts.value : undefined);
  const gap = gapRows(d, o, gaps.ready ? gaps.value : undefined);
  const t = sum.reduce((s, r) => ({ cash: s.cash + r.cash, upi: s.upi + r.upi, card: s.card + r.card, income: s.income + r.income, expenses: s.expenses + r.expenses, profit: s.profit + r.profit }), { cash: 0, upi: 0, card: 0, income: 0, expenses: 0, profit: 0 });

  return (
    <div className="print-page">
      <p className="no-print">
        <Link href={`/export?from=${o.from}&to=${o.to}&clinic=${o.scope}`}>← Back to export</Link>
      </p>
      <h1>Sarada Dental Care: profit and loss</h1>
      <p className="muted">
        {SCOPE_LABEL[o.scope]} · {periodLabel(o)} · made by SDC Ledger for {user.name} on{" "}
        {new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium" })}
      </p>
      <PrintButton />

      <h2>Summary</h2>
      <div className="table-wrap">
        <table className="stack">
          <thead>
            <tr><th>Month</th><th className="num">Cash</th><th className="num">UPI</th><th className="num">Card</th><th className="num">Income</th><th className="num">Expenses</th><th className="num">Profit</th></tr>
          </thead>
          <tbody>
            {sum.map((r) => (
              <tr key={r.month}>
                <td className="row-title">{monthLabel(r.month)}</td>
                <td data-label="Cash" className="num">{inr(r.cash)}</td>
                <td data-label="UPI" className="num">{inr(r.upi)}</td>
                <td data-label="Card" className="num">{inr(r.card)}</td>
                <td data-label="Income" className="num">{inr(r.income)}</td>
                <td data-label="Expenses" className="num">{inr(r.expenses)}</td>
                <td data-label="Profit" className={`num ${r.profit >= 0 ? "pos" : "neg"}`}>{inr(r.profit)}</td>
              </tr>
            ))}
            {sum.length > 1 && (
              <tr className="total-row">
                <td className="row-title">Total</td>
                <td data-label="Cash" className="num">{inr(t.cash)}</td>
                <td data-label="UPI" className="num">{inr(t.upi)}</td>
                <td data-label="Card" className="num">{inr(t.card)}</td>
                <td data-label="Income" className="num">{inr(t.income)}</td>
                <td data-label="Expenses" className="num">{inr(t.expenses)}</td>
                <td data-label="Profit" className={`num ${t.profit >= 0 ? "pos" : "neg"}`}>{inr(t.profit)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h2>Expenses by category</h2>
      <div className="table-wrap">
        <table className="stack">
          <thead><tr><th>Category</th><th className="num">Total for the period</th></tr></thead>
          <tbody>
            {cat.rows.length === 0 && <tr><td colSpan={2} className="muted">No expenses in this period.</td></tr>}
            {cat.rows.map((r) => (
              <tr key={r.category}><td className="row-title">{r.category}</td><td data-label="Total" className="num">{inr(r.total)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Petty cash</h2>
      <div className="table-wrap">
        <table className="stack">
          <thead><tr><th>Month</th><th>Clinic</th><th className="num">Opening</th><th className="num">Received</th><th className="num">Spent</th><th className="num">Expected</th><th className="num">Counted</th></tr></thead>
          <tbody>
            {petty.map((p) => (
              <tr key={`${p.month}${p.clinic}`}>
                <td className="row-title">{monthLabel(p.month)} · {p.clinic}</td>
                <td data-label="Clinic">{p.clinic}</td>
                <td data-label="Opening" className="num">{inr(p.opening)}</td>
                <td data-label="Received" className="num">{inr(p.received)}</td>
                <td data-label="Spent" className="num">{inr(p.spent)}</td>
                <td data-label="Expected" className="num">{inr(p.expected)}</td>
                <td data-label="Counted" className="num">{p.counted === null ? "–" : inr(p.counted)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Reconciliation gaps</h2>
      <p>
        {gap.length === 0 ? "No gaps in this period." : `${gap.length} gaps, ${gap.filter((g) => !g.answer).length} without a reason yet. The full list with reasons is in the Excel file.`}
      </p>
    </div>
  );
}
