import { requireAdmin } from "@/lib/auth";
import { getStore } from "@/lib/data/store";
import { ImportForm } from "@/components/ImportForm";
import { DebitForm } from "@/components/DebitForm";
import { CLINIC_LABEL, BANK_KIND_LABEL } from "@/lib/types";
import { deleteRule, reapplyRules } from "./actions";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  await requireAdmin();
  const store = getStore();
  const [d, imports] = await Promise.all([store.read(), store.listImports(20)]);
  const unknown = d.bankTxns.filter((t) => t.kind === "UNKNOWN_OUT").sort((a, b) => a.date.localeCompare(b.date));
  const used = new Map<string, number>();
  for (const t of d.bankTxns) if (t.ruleId) used.set(t.ruleId, (used.get(t.ruleId) ?? 0) + 1);

  return (
    <>
      <h1>Import bank and PappyJoe files</h1>
      <ImportForm />

      <h2>Bank payments that need your answer ({unknown.length})</h2>
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

      <h2>Recent imports</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>File</th>
              <th>Source</th>
              <th>Dates</th>
              <th className="num">Rows</th>
              <th className="num">New</th>
            </tr>
          </thead>
          <tbody>
            {imports.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">Nothing imported yet.</td>
              </tr>
            )}
            {imports.map((b) => (
              <tr key={b.id}>
                <td>{new Date(b.importedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" })}</td>
                <td className="wrap">{b.fileName}</td>
                <td>{b.source === "HDFC" ? "HDFC" : `PappyJoe · ${b.clinic ? CLINIC_LABEL[b.clinic] : ""}`}</td>
                <td>{b.firstDate} to {b.lastDate}</td>
                <td className="num">{b.rowsRead}</td>
                <td className="num">{b.rowsAdded}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Rules for bank payments</h2>
      <p className="muted">
        The first matching rule (lowest number) decides. A clinic written in the narration (SDC1, SDC 2) wins over the rule&apos;s clinic.
      </p>
      <form action={reapplyRules} style={{ marginBottom: 8 }}>
        <button type="submit" className="small secondary">Run the rules again on unanswered payments</button>
      </form>
      <div className="table-wrap">
        <table>
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
                  <td className="num">{r.priority}</td>
                  <td className="wrap">
                    <code>{r.pattern}</code>
                    {r.matchType === "regex" && <span className="muted"> (pattern)</span>}
                  </td>
                  <td>
                    {r.action === "EXPENSE" ? r.category : BANK_KIND_LABEL[r.action]}
                    {r.clinic && r.clinic !== "SHARED" ? ` · ${CLINIC_LABEL[r.clinic]}` : ""}
                  </td>
                  <td className="num">{used.get(r.id) ?? 0}</td>
                  <td>
                    <form action={deleteRule}>
                      <input type="hidden" name="id" value={r.id} />
                      <button type="submit" className="small secondary">Delete</button>
                    </form>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
