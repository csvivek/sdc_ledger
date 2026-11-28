import { requireAdmin } from "@/lib/auth";
import { getExtras } from "@/lib/data/extras";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { BACKUP_REMIND_DAYS, BACKUP_TABLES, backupAgeText, backupStatus } from "@/lib/backup";
import { BackupCheckForm } from "@/components/BackupCheckForm";

export const dynamic = "force-dynamic";

const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });

export default async function BackupPage() {
  await requireAdmin();
  const extras = getExtras();
  const [history, live] = await Promise.all([extras.listBackups(10), extras.countAll()]);
  const last = history.ready ? history.value[0] : undefined;
  const status = backupStatus(last?.takenAt);
  const total = Object.values(live.counts).reduce((s, n) => s + n, 0);

  return (
    <>
      <h1>Backup</h1>

      <div className={`card ${status.due ? "notice" : ""}`}>
        <div className="label strong">{history.ready ? backupAgeText(status) : "Backup history is not switched on yet"}</div>
        {history.ready && last && (
          <p className="muted">
            {when(last.takenAt)} by {last.takenByName ?? "admin"} · {last.format === "json" ? "full backup file" : "Excel copy"} ·{" "}
            {last.totalRows.toLocaleString("en-IN")} rows
          </p>
        )}
        {!history.ready && (
          <p className="muted">Downloads below still work. Once the backup SQL is run, the app remembers each download and reminds you.</p>
        )}
        {status.due && history.ready && (
          <p>Please download a backup now and keep it somewhere safe. The app reminds you when the last one is {BACKUP_REMIND_DAYS} days old.</p>
        )}
      </div>

      <h2>Does Supabase back up the database?</h2>
      <div className="card">
        {isSupabaseConfigured ? (
          <>
            <p>
              <strong>Not automatically, on the plan in use.</strong> When this page was built (28 Nov 2026) the Supabase project was on the
              Free plan, which keeps <strong>no</strong> automatic backups. Paid plans (Pro and above) keep a daily backup for 7 days or more,
              listed in Supabase under Database &gt; Backups.
            </p>
            <p className="muted">
              This app cannot read Supabase&apos;s backup list itself (that needs a Supabase account token, which the app should not hold), so it
              does not claim to know. The download below is the backup you control.
            </p>
          </>
        ) : (
          <p className="mock-note">Prototype mode: the data here is fake and kept on the server only. The downloads work the same way.</p>
        )}
      </div>

      <h2>Download a full backup</h2>
      <div className="card form-card">
        <p>
          Every table: {total.toLocaleString("en-IN")} rows now. Logins and passwords are kept by Supabase and are not in the file; imported
          original bank and PappyJoe files are not in it either.
        </p>
        <a className="button full" href="/backup/download?format=json" download>
          Download full backup (.json)
        </a>
        <p className="muted">The .json file is the complete copy, for restoring if ever needed. Keep it in Google Drive or on a computer.</p>
        <a className="button secondary full" href="/backup/download?format=xlsx" download>
          Download as Excel (.xlsx)
        </a>
        <p className="muted">Same data, one sheet per table, for reading.</p>
      </div>

      <BackupCheckForm />

      <h2>What is in it</h2>
      <div className="table-wrap">
        <table className="stack">
          <thead>
            <tr>
              <th>Table</th>
              <th>Holds</th>
              <th className="num">Rows now</th>
              {last && <th className="num">In last backup</th>}
            </tr>
          </thead>
          <tbody>
            {BACKUP_TABLES.filter((t) => t.name in live.counts || live.missing.includes(t.name)).map((t) => (
              <tr key={t.name}>
                <td className="row-title">{t.name}</td>
                <td data-label="Holds">{t.about}</td>
                <td data-label="Rows now" className="num">
                  {t.name in live.counts ? live.counts[t.name] : <span className="muted">not set up yet</span>}
                </td>
                {last && (
                  <td data-label="In last backup" className="num">
                    {t.name in last.counts ? last.counts[t.name] : "–"}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {history.ready && history.value.length > 1 && (
        <>
          <h2>Earlier downloads</h2>
          <div className="table-wrap">
            <table className="stack">
              <thead>
                <tr>
                  <th>When</th>
                  <th>By</th>
                  <th>File</th>
                  <th className="num">Rows</th>
                </tr>
              </thead>
              <tbody>
                {history.value.map((b) => (
                  <tr key={b.id}>
                    <td className="row-title">{when(b.takenAt)}</td>
                    <td data-label="By">{b.takenByName ?? ""}</td>
                    <td data-label="File">{b.format === "json" ? "Full backup" : "Excel copy"}</td>
                    <td data-label="Rows" className="num">{b.totalRows.toLocaleString("en-IN")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
