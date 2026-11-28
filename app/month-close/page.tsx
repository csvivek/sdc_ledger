import Link from "next/link";
import { BooksBar } from "@/components/BooksBar";
import { requireAdmin } from "@/lib/auth";
import { getStore } from "@/lib/data/store";
import { getExtras } from "@/lib/data/extras";
import { monthLabel, monthsIn, todayInIndia } from "@/lib/calc";
import { blockers, closableMonths, closeChecklist, type CheckItem } from "@/lib/month-close";
import { CloseForm, ReopenForm } from "@/components/MonthCloseForms";

export const dynamic = "force-dynamic";

const ICON: Record<CheckItem["status"], string> = { done: "✓", todo: "✗", warn: "!", na: "–" };
const STATUS: Record<CheckItem["status"], string> = { done: "Done", todo: "Not done", warn: "Check", na: "Not switched on" };
const when = (iso?: string) => (iso ? new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) : "");

function Checklist({ items }: { items: CheckItem[] }) {
  return (
    <ul className="checklist">
      {items.map((i) => (
        <li key={i.key} className={`check-${i.status}`}>
          <span className="check-icon" aria-hidden="true">{ICON[i.status]}</span>
          <div>
            <strong>{i.label}</strong> <span className="sr-only">{STATUS[i.status]}</span>
            <div className="muted">
              {i.detail} {i.href && i.status !== "done" && <Link href={i.href}>Open</Link>}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

export default async function MonthClosePage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const x = getExtras();
  const [d, closes, gaps, counts] = await Promise.all([getStore().read(), x.listCloses(), x.gapAnswers(), x.pettyCounts()]);
  const current = todayInIndia().slice(0, 7);
  const months = closableMonths(monthsIn(d), current);
  const month = sp.month && months.includes(sp.month) ? sp.month : months[months.length - 1];
  const label = monthLabel(month);
  const state = closes.ready ? closes.value.find((c) => c.month === month) : undefined;
  const items = closeChecklist(d, month, { gapAnswers: gaps.ready ? gaps.value : undefined, pettyCounts: counts.ready ? counts.value : undefined });
  const events = await x.closeEvents(month);
  const closedSet = new Set(closes.ready ? closes.value.filter((c) => c.closed).map((c) => c.month) : []);

  return (
    <>
      <h1>Month close</h1>
      <p className="muted">
        Close a month once its books are complete. After that nothing dated in it can be added, changed or deleted (expenses, imports,
        petty cash, notes and answers) until the admin reopens it with a reason.
      </p>

      <BooksBar d={d} month={month} active="/month-close" />

      {!closes.ready && (
        <p className="notice">Month close is not switched on yet. The checklist below works; closing needs the month close SQL to be run first.</p>
      )}

      {state?.closed ? (
        <>
          <div className="card">
            <div className="label strong">🔒 {label} is closed</div>
            <p className="muted">
              Closed by {state.closedByName ?? "admin"} on {when(state.closedAt)}
              {state.note ? ` · “${state.note}”` : ""}
            </p>
          </div>
          <h2>Checklist when it was closed</h2>
          <Checklist items={state.checklist} />
          <ReopenForm month={month} label={label} />
        </>
      ) : (
        <>
          <h2>Checklist for {label}</h2>
          <Checklist items={items} />
          {closes.ready && <CloseForm month={month} label={label} blockers={blockers(items).length} />}
        </>
      )}

      {events.ready && events.value.length > 0 && (
        <>
          <h2>History of {label}</h2>
          <div className="table-wrap">
            <table className="stack">
              <thead>
                <tr><th>When</th><th>What</th><th>Who</th><th>Reason or note</th></tr>
              </thead>
              <tbody>
                {events.value.map((e) => (
                  <tr key={e.id}>
                    <td className="row-title">{when(e.at)}</td>
                    <td data-label="What">{e.action === "close" ? "Closed" : "Reopened"}</td>
                    <td data-label="Who">{e.byName ?? ""}</td>
                    <td data-label="Reason or note" className="wrap">{e.reason}</td>
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
