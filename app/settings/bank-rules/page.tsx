import { requireAdmin } from "@/lib/auth";
import { getStore } from "@/lib/data/store";
import { RuleForm } from "@/components/RuleForm";
import { CLINIC_LABEL, BANK_KIND_LABEL } from "@/lib/types";
import { reapplyRules } from "../../import/actions";

export const dynamic = "force-dynamic";

export default async function BankRulesPage() {
  await requireAdmin();
  const d = await getStore().read();
  const used = new Map<string, number>();
  for (const t of d.bankTxns) if (t.ruleId) used.set(t.ruleId, (used.get(t.ruleId) ?? 0) + 1);

  return (
    <>
      <h1>Bank rules</h1>
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
