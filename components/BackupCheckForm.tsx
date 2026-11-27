"use client";

import { useActionState } from "react";
import { checkBackup, type BackupCheckState } from "@/app/backup/actions";

const when = (iso?: string) =>
  iso ? new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) : "unknown time";

export function BackupCheckForm() {
  const [state, action, pending] = useActionState<BackupCheckState, FormData>(checkBackup, {});
  const r = state.result;
  return (
    <form action={action} className="card form-card">
      <label htmlFor="backup-file">Check a backup file</label>
      <input id="backup-file" name="file" type="file" accept=".json,application/json" required />
      <p className="muted">Pick a .json backup you downloaded earlier. The app opens it and counts what is inside. Nothing is changed or restored.</p>
      <button type="submit" className="full" disabled={pending}>{pending ? "Checking…" : "Check this file"}</button>
      <div aria-live="polite">
        {state.error && <p className="err">{state.error}</p>}
        {r && !r.ok && <p className="err">✗ {state.fileName}: {r.problem}</p>}
        {r?.ok && (
          <>
            <p className="ok">
              ✓ {state.fileName} is a complete backup from {when(r.createdAt)}
              {r.createdBy ? ` by ${r.createdBy}` : ""}, with {r.totalInFile.toLocaleString("en-IN")} rows.
            </p>
            <div className="table-wrap">
              <table className="stack">
                <thead>
                  <tr>
                    <th>Table</th>
                    <th className="num">In the file</th>
                    <th className="num">In the database now</th>
                  </tr>
                </thead>
                <tbody>
                  {r.tables.map((t) => (
                    <tr key={t.name}>
                      <td className="row-title">{t.name}</td>
                      <td data-label="In the file" className="num">{t.inFile}</td>
                      <td data-label="In the database now" className="num">
                        {t.now === null ? <span className="muted">not set up</span> : t.now}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted">More rows now than in the file is normal: those were added after the backup.</p>
          </>
        )}
      </div>
    </form>
  );
}
