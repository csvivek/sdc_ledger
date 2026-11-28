import { requireAdmin } from "@/lib/auth";
import { getStore } from "@/lib/data/store";
import { MonthDeleteForm, type MonthOptions } from "@/components/MonthDeleteForm";
import { inr, monthLabel } from "@/lib/calc";
import { CLINIC_LABEL } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function DeleteMonthPage() {
  await requireAdmin();
  const store = getStore();
  const [d, deletions] = await Promise.all([store.read(), store.listImportDeletions(10)]);
  const monthsOf = (dates: string[]) => [...new Set(dates.map((x) => x.slice(0, 7)))].sort().reverse();
  const deleteMonths: MonthOptions = {
    HDFC: monthsOf(d.bankTxns.map((t) => t.date)),
    "PAPPYJOE:SDC1": monthsOf(d.pjReceipts.filter((r) => r.clinic === "SDC1").map((r) => r.date)),
    "PAPPYJOE:SDC2": monthsOf(d.pjReceipts.filter((r) => r.clinic === "SDC2").map((r) => r.date)),
  };
  const userName = (id: string) => d.users.find((u) => u.id === id)?.name ?? "Admin";

  return (
    <>
      <h1>Delete a month&apos;s import</h1>
      <p className="muted">
        If a month was imported wrongly, delete that month&apos;s bank rows, or one clinic&apos;s PappyJoe payments, and import the
        right file again. Only imported rows are deleted.
      </p>
      <MonthDeleteForm months={deleteMonths} />
      {deletions.length > 0 && (
        <div className="table-wrap">
          <table className="stack">
            <thead>
              <tr>
                <th>When</th>
                <th>Deleted</th>
                <th>Month</th>
                <th className="num">Rows</th>
                <th className="num">In / out</th>
                <th>By</th>
              </tr>
            </thead>
            <tbody>
              {deletions.map((x) => (
                <tr key={x.id}>
                  <td data-label="When">{new Date(x.deletedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" })}</td>
                  <td data-label="Deleted">{x.source === "HDFC" ? "HDFC" : `PappyJoe · ${x.clinic ? CLINIC_LABEL[x.clinic] : ""}`}</td>
                  <td data-label="Month">{monthLabel(x.month)}</td>
                  <td data-label="Rows" className="num">{x.rowsDeleted}{x.cardsDeleted ? ` (+${x.cardsDeleted} card)` : ""}</td>
                  <td data-label="In / out" className="num">{inr(x.moneyIn)} / {inr(x.moneyOut)}</td>
                  <td data-label="By">{userName(x.deletedBy)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

    </>
  );
}
