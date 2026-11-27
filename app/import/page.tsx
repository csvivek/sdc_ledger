import { requireAdmin } from "@/lib/auth";
import { getStore } from "@/lib/data/store";
import { ImportForm } from "@/components/ImportForm";
import { DebitForm } from "@/components/DebitForm";
import { RuleForm } from "@/components/RuleForm";
import { DebitNotices } from "@/components/DebitNotices";
import { MonthDeleteForm, type MonthOptions } from "@/components/MonthDeleteForm";
import { inr, monthLabel } from "@/lib/calc";
import { CLINIC_LABEL, BANK_KIND_LABEL } from "@/lib/types";
import { reapplyRules } from "./actions";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  await requireAdmin();
  const store = getStore();
  const [d, imports, deletions] = await Promise.all([store.read(), store.listImports(20), store.listImportDeletions(10)]);
  const monthsOf = (dates: string[]) => [...new Set(dates.map((x) => x.slice(0, 7)))].sort().reverse();
  const deleteMonths: MonthOptions = {
    HDFC: monthsOf(d.bankTxns.map((t) => t.date)),
    "PAPPYJOE:SDC1": monthsOf(d.pjReceipts.filter((r) => r.clinic === "SDC1").map((r) => r.date)),
    "PAPPYJOE:SDC2": monthsOf(d.pjReceipts.filter((r) => r.clinic === "SDC2").map((r) => r.date)),
  };
  const userName = (id: string) => d.users.find((u) => u.id === id)?.name ?? "Admin";
  const unknown = d.bankTxns.filter((t) => t.kind === "UNKNOWN_OUT").sort((a, b) => a.date.localeCompare(b.date));
  const used = new Map<string, number>();
  for (const t of d.bankTxns) if (t.ruleId) used.set(t.ruleId, (used.get(t.ruleId) ?? 0) + 1);

  return (
    <>
      <h1>Import bank statement and PappyJoe income</h1>
      <ImportForm />

      <h2>Bank payments that need your answer ({unknown.length})</h2>
      <DebitNotices>
      {unknown.length === 0 ? (
        <p className="muted">None. Every imported bank debit has a category.</p>
      ) : (
        <>
          <p className="muted">
            These did not match any rule. Say what each one is. Leave &quot;Remember&quot; ticked and the app will categorise the
            same kind of payment by itself from now on.
          </p>
          {unknown.map((t) => (
            <DebitForm key={t.id} txn={t} categories={d.categories} />
          ))}
        </>
      )}
      </DebitNotices>

      <h2>Recent imports</h2>
      <div className="table-wrap">
        <table className="stack">
          <thead>
            <tr>
              <th>When</th>
              <th>File</th>
              <th>Source</th>
              <th>Dates</th>
              <th className="num">Rows</th>
              <th className="num">New</th>
              <th>Original</th>
            </tr>
          </thead>
          <tbody>
            {imports.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">Nothing imported yet.</td>
              </tr>
            )}
            {imports.map((b) => (
              <tr key={b.id}>
                <td data-label="When">{new Date(b.importedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" })}</td>
                <td data-label="File" className="wrap">{b.fileName}</td>
                <td data-label="Source">{b.source === "HDFC" ? "HDFC" : `PappyJoe · ${b.clinic ? CLINIC_LABEL[b.clinic] : ""}`}</td>
                <td data-label="Dates">{b.firstDate} to {b.lastDate}</td>
                <td data-label="Rows" className="num">{b.rowsRead}</td>
                <td data-label="New" className="num">{b.rowsAdded}</td>
                <td data-label="Original">
                  {b.filePath ? <a href={`/import/file/${b.id}`}>Download</a> : <span className="muted">Not kept</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Delete imported data for a month</h2>
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

      <h2>Rules for bank payments</h2>
      <p className="muted">
        The first matching rule (lowest number) decides. A clinic written in the narration (SDC1, SDC 2) wins over the rule&apos;s clinic.
        Tap Edit on a rule to change it. Saving a rule also runs the rules again on payments still waiting for an answer.
      </p>
      <details className="card">
        <summary>Add a rule</summary>
        <RuleForm categories={d.categories} />
      </details>
      <form action={reapplyRules} style={{ marginBottom: 8 }}>
        <button type="submit" className="small secondary">Run the rules again on unanswered payments</button>
      </form>
      <div className="table-wrap">
        <table className="stack">
          <thead>
            <tr>
              <th className="num">#</th>
              <th>Narration contains</th>
              <th>Means</th>
              <th className="num">Used</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {[...d.bankRules]
              .sort((a, b) => a.priority - b.priority)
              .map((r) => (
                <tr key={r.id}>
                  <td data-label="#" className="num">{r.priority}</td>
                  <td data-label="Narration contains" className="wrap">
                    <code>{r.pattern}</code>
                    {r.matchType === "regex" && <span className="muted"> (pattern)</span>}
                  </td>
                  <td data-label="Means">
                    {r.action === "EXPENSE" ? r.category : BANK_KIND_LABEL[r.action]}
                    {r.clinic && r.clinic !== "SHARED" ? ` · ${CLINIC_LABEL[r.clinic]}` : ""}
                  </td>
                  <td data-label="Used" className="num">{used.get(r.id) ?? 0}</td>
                  <td className="actions">
                    <details>
                      <summary>Edit</summary>
                      <RuleForm rule={r} categories={d.categories} used={used.get(r.id) ?? 0} />
                    </details>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
