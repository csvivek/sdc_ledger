"use client";

import { useActionState } from "react";
import { importFiles, type ImportState } from "@/app/import/actions";

export function ImportForm() {
  const [state, action, pending] = useActionState<ImportState, FormData>(importFiles, {});
  return (
    <form action={action} className="card">
      <p>
        Only two files are imported: the clinic&apos;s <strong>HDFC bank statement</strong> and the <strong>PappyJoe Payments</strong>{" "}
        export (income). Expenses are not imported: they are entered in this app and matched to the bank statement.
      </p>

      <label htmlFor="bank">1. HDFC bank statement (.xls)</label>
      <input id="bank" name="bank" type="file" accept=".xls,.xlsx" />
      <p className="muted">Exactly as downloaded from HDFC net banking, with the statement summary at the end.</p>

      <label htmlFor="pappyjoe">2. PappyJoe Payments export (.xlsx)</label>
      <input id="pappyjoe" name="pappyjoe" type="file" multiple accept=".xlsx,.xls" />
      <p className="muted">One file per clinic; you can pick both. The clinic is worked out from the patient ids.</p>

      <p className="muted">
        Any other file is turned away and nothing from it is saved. Uploading the same file again does not add anything twice. A
        private copy of each imported file is kept; only admins can download it.
      </p>
      <button type="submit" disabled={pending}>{pending ? "Checking and importing…" : "Import"}</button>
      {state.error && <p className="err">{state.error}</p>}
      {state.results?.map((r, i) => (
        <div key={`${i}-${r.file}`} className={`import-result ${r.ok ? "good" : "bad"}`}>
          <strong>{r.ok ? "✓" : "✗"} {r.file}</strong>
          <ul>
            {r.lines.map((l, j) => (
              <li key={j}>{l}</li>
            ))}
          </ul>
        </div>
      ))}
    </form>
  );
}
