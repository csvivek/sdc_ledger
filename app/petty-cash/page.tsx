import { requireAdmin } from "@/lib/auth";
import { getStore } from "@/lib/data/store";
import { inr, monthLabel, monthsIn, pettyCashAllTime, pettyCashMonth, todayInIndia } from "@/lib/calc";
import { differs } from "@/lib/petty";
import { CLINICS, CLINIC_LABEL, type ClinicId, type LedgerData, type PettyCount } from "@/lib/types";
import { MonthPicker, pickMonth } from "@/components/MonthPicker";
import { PettyCountForm } from "@/components/PettyCountForm";

export const dynamic = "force-dynamic";

type Row = { date: string; what: string; inAmt: number; outAmt: number; key: string };

/** Last day of a month, for dating its count adjustment in the list. */
const monthEnd = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return `${m}-${String(new Date(y, mo, 0).getDate()).padStart(2, "0")}`;
};

function movementRows(
  d: LedgerData,
  transfersIn: { id: string; date: string; amount: number; note: string }[],
  spent: { id: string; date: string; amount: number; category: string; note: string }[],
  adjustments: { count: PettyCount; difference: number }[],
): Row[] {
  const reason = (id?: string) => d.pettyCountReasons.find((r) => r.id === id)?.label;
  return [
    ...transfersIn.map((t) => ({ date: t.date, what: t.note, inAmt: t.amount, outAmt: 0, key: t.id })),
    ...spent.map((e) => ({ date: e.date, what: `${e.category}: ${e.note}`, inAmt: 0, outAmt: e.amount, key: e.id })),
    ...adjustments
      .filter((a) => differs(a.difference))
      .map(({ count: c, difference }) => ({
        date: monthEnd(c.month),
        what: `Month-end count ${inr(c.counted)}, ${difference > 0 ? "more" : "less"} than expected${reason(c.reasonId) ? `: ${reason(c.reasonId)}` : ""}`,
        inAmt: difference > 0 ? difference : 0,
        outAmt: difference < 0 ? -difference : 0,
        key: c.id,
      })),
  ].sort((a, b) => b.date.localeCompare(a.date) || b.inAmt - a.inAmt);
}

function summary(d: LedgerData, c: ClinicId, month: string, current: string) {
  if (month === "all") {
    const p = pettyCashAllTime(d, c);
    return {
      line: `Opening ${inr(p.opening)} + received ${inr(p.totalIn)} − spent ${inr(p.totalOut)}${
        differs(p.adjusted) ? ` ${p.adjusted > 0 ? "+" : "−"} count differences ${inr(Math.abs(p.adjusted))}` : ""
      }`,
      balance: p.balance,
      balanceLabel: "Balance now",
      rows: movementRows(d, p.transfersIn, p.spent, p.adjustments),
    };
  }
  const p = pettyCashMonth(d, c, month);
  const counted = p.count
    ? `. Counted ${inr(p.count.counted)}${differs(p.difference) ? ` (${p.difference > 0 ? "+" : "−"}${inr(Math.abs(p.difference))})` : ", matches"}`
    : "";
  return {
    line: `Carried in from last month ${inr(p.carriedIn)} + received ${inr(p.received)} − spent ${inr(p.spent)} = expected ${inr(p.expected)}${counted}`,
    balance: p.leftAtEnd,
    // The current month is not over yet, so its balance is what is in the box now.
    balanceLabel: p.count ? "Counted at month end" : month === current ? "Left now" : "Left at month end",
    rows: movementRows(d, p.transfersIn, p.spentList, p.count ? [{ count: p.count, difference: p.difference }] : []),
    month: p,
  };
}

export default async function PettyCashPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  await requireAdmin();
  const d = await getStore().read();
  const months = monthsIn(d);
  const requested = (await searchParams).month;
  const month = requested === "all" ? "all" : pickMonth(months, requested);
  const title = month === "all" ? "all time" : monthLabel(month);
  const current = todayInIndia().slice(0, 7);
  const userName = (id: string) => d.users.find((u) => u.id === id)?.name ?? "someone";

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
          const s = summary(d, c, month, current);
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

      {month !== "all" && (
        <>
          <h2>Month-end count</h2>
          <p className="muted">
            At the end of the month, count the cash in each clinic&apos;s box and type it here. The counted amount is what next
            month starts with. If it is different from what the app expected, pick why.
          </p>
          <div className="grid">
            {CLINICS.map((c) => {
              const p = pettyCashMonth(d, c, month);
              const saved = p.count && {
                id: p.count.id,
                counted: p.count.counted,
                reasonId: p.count.reasonId,
                note: p.count.note,
                countedAt: p.count.countedAt,
                countedByName: userName(p.count.countedBy),
              };
              return (
                <div key={`${c}-${month}`} className="card">
                  <div className="strong">{CLINIC_LABEL[c]}</div>
                  <PettyCountForm
                    key={`${c}-${month}-${p.count?.id ?? "new"}`}
                    clinic={c}
                    month={month}
                    expected={p.expected}
                    reasons={d.pettyCountReasons}
                    saved={saved}
                  />
                </div>
              );
            })}
          </div>
        </>
      )}

      {CLINICS.map((c) => {
        const { rows } = summary(d, c, month, current);
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
                    <th className="num">In</th>
                    <th className="num">Out</th>
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
                      <td data-label="In" className="num pos">{r.inAmt ? inr(r.inAmt) : ""}</td>
                      <td data-label="Out" className="num">{r.outAmt ? inr(r.outAmt) : ""}</td>
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
