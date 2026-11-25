"use client";

import { useActionState } from "react";
import { importFiles, type ImportState } from "@/app/import/actions";

export function ImportForm() {
  const [state, action, pending] = useActionState<ImportState, FormData>(importFiles, {});
  return (
    <form action={action} className="card">
      <label htmlFor="files">HDFC statement (.xls) and PappyJoe Payments exports (.xlsx)</label>
      <input id="files" name="files" type="file" multiple accept=".xls,.xlsx" required />
      <p className="muted">
        Upload the files exactly as downloaded; you can pick several at once. The app works out which is which, and which clinic a
        PappyJoe file belongs to from the patient ids. Uploading the same file again does not add anything twice.
      </p>
      <button type="submit" disabled={pending}>{pending ? "Importing…" : "Import"}</button>
      {state.error && <p className="err">{state.error}</p>}
      {state.results?.map((r) => (
        <div key={r.file} className={`import-result ${r.ok ? "good" : "bad"}`}>
          <strong>{r.ok ? "✓" : "✗"} {r.file}</strong>
          <ul>
            {r.lines.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </div>
      ))}
    </form>
  );
}
