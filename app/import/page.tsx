import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { BooksBar } from "@/components/BooksBar";
import { pickMonth } from "@/components/MonthPicker";
import { monthsIn } from "@/lib/calc";
import { getStore } from "@/lib/data/store";
import { ImportForm } from "@/components/ImportForm";
import { CLINIC_LABEL } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  await requireAdmin();
  const store = getStore();
  const [d, imports] = await Promise.all([store.read(), store.listImports(20)]);
  const unknown = d.bankTxns.filter((t) => t.kind === "UNKNOWN_OUT");
  const month = pickMonth(monthsIn(d), (await searchParams).month);

  return (
    <>
      <h1>Import bank statement and PappyJoe income</h1>
      <BooksBar d={d} month={month} active="/import" />
      <ImportForm />

      {unknown.length > 0 && (
        <p className="notice">
          {unknown.length} bank payment{unknown.length === 1 ? "" : "s"} need{unknown.length === 1 ? "s" : ""} a category.{" "}
          <Link href="/reconciliation">Answer on Reconcile</Link>
        </p>
      )}

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

      <p className="muted">
        Bank rules and deleting a month&apos;s import are in <Link href="/settings">Settings</Link>.
      </p>
    </>
  );
}
