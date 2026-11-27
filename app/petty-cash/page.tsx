import { requireAdmin } from "@/lib/auth";
import { getStore } from "@/lib/data/store";
import { inr, monthLabel, monthsIn, pettyCash, pettyCashMonth, todayInIndia } from "@/lib/calc";
import { CLINICS, CLINIC_LABEL, type ClinicId, type LedgerData } from "@/lib/types";
import { MonthPicker, pickMonth } from "@/components/MonthPicker";

export const dynamic = "force-dynamic";

type Row = { date: string; what: string; inAmt: number; outAmt: number; key: string };

function movementRows(
  transfersIn: { id: string; date: string; amount: number; note: string }[],
  spent: { id: string; date: string; amount: number; category: string; note: string }[],
): Row[] {
  return [
    ...transfersIn.map((t) => ({ date: t.date, what: t.note, inAmt: t.amount, outAmt: 0, key: t.id })),
    ...spent.map((e) => ({ date: e.date, what: `${e.category}: ${e.note}`, inAmt: 0, outAmt: e.amount, key: e.id })),
  ].sort((a, b) => b.date.localeCompare(a.date) || b.inAmt - a.inAmt);
}

function summary(d: LedgerData, c: ClinicId, month: string) {
  if (month === "all") {
    const p = pettyCash(d, c);
    return {
      line: `Opening ${inr(p.opening)} + received ${inr(p.totalIn)} − spent ${inr(p.totalOut)}`,
      balance: p.balance,
      balanceLabel: "Balance now",
      rows: movementRows(p.transfersIn, p.spent),
    };
  }
  const p = pettyCashMonth(d, c, month);
  return {
    line: `Carried in from last month ${inr(p.carriedIn)} + received ${inr(p.received)} − spent ${inr(p.spent)}`,
    balance: p.leftAtEnd,
    // The current month is not over yet, so its balance is what is in the box now.
    balanceLabel: month === todayInIndia().slice(0, 7) ? "Left now" : "Left at month end",
    rows: movementRows(p.transfersIn, p.spentList),
  };
}

export default async function PettyCashPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  await requireAdmin();
  const d = await getStore().read();
  const months = monthsIn(d);
  const requested = (await searchParams).month;
  const month = requested === "all" ? "all" : pickMonth(months, requested);
  const title = month === "all" ? "all time" : monthLabel(month);

  return (
    <>
      <h1>Petty cash: {title}</h1>
      <MonthPicker months={months} active={month} basePath="/petty-cash" allTime />
      <p className="muted">
        The doctor&apos;s two monthly withdrawals (one per clinic) move money from the bank into each clinic&apos;s petty cash.
        They are transfers, not expenses. Expenses paid from petty cash reduce the balance. Cash left in the box at month end
        is carried into the next month.
      </p>
      <p className="muted">Transfers marked PETTY CASH in the imported HDFC statement are split equally between the clinics.</p>

      <div className="grid">
        {CLINICS.map((c) => {
          const s = summary(d, c, month);
          return (
            <div key={c} className="card stat">
              <div className="label">
                {CLINIC_LABEL[c]}: {s.balanceLabel.toLowerCase()}
              </div>
              <div className={`value ${s.balance < 0 ? "neg" : ""}`}>{inr(s.balance)}</div>
              <div className="muted">{s.line}</div>
            </div>
          );
        })}
      </div>

      {CLINICS.map((c) => {
        const { rows } = summary(d, c, month);
        return (
          <section key={c}>
            <h2>
              {CLINIC_LABEL[c]}: movements {month === "all" ? "(all time)" : `in ${title}`}
            </h2>
            <div className="table-wrap">
              <table className="stack">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>What</th>
                    <th className="num">In (transfer)</th>
                    <th className="num">Out (expense)</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={4} className="muted">
                        {month === "all" ? "No movements yet." : "No movements this month."}
                      </td>
                    </tr>
                  )}
                  {rows.map((r) => (
                    <tr key={r.key}>
                      <td data-label="Date">{r.date}</td>
                      <td data-label="What" className="wrap">{r.what}</td>
                      <td data-label="In (transfer)" className="num pos">{r.inAmt ? inr(r.inAmt) : ""}</td>
                      <td data-label="Out (expense)" className="num">{r.outAmt ? inr(r.outAmt) : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </>
  );
}
