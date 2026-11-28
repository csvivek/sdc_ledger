import Link from "next/link";
import { getExtras } from "@/lib/data/extras";
import { monthLabel, monthsIn, todayInIndia } from "@/lib/calc";
import { closableMonths } from "@/lib/month-close";
import { booksSteps } from "@/lib/books";
import type { LedgerData, MonthKey } from "@/lib/types";

/** Most recent months shown as chips; older ones are still reachable by link. */
const SHOWN = 12;

/**
 * Top of every Books page: one month picker shared by the five steps, and the
 * steps themselves, each marked done or with what is left. Changing step keeps
 * the month.
 */
export async function BooksBar({ d, month, active }: { d: LedgerData; month: MonthKey | "all"; active: string }) {
  const x = getExtras();
  const [gaps, counts, closes] = await Promise.all([x.gapAnswers(), x.pettyCounts(), x.listCloses()]);
  const current = todayInIndia().slice(0, 7);
  const all = active === "/month-close" ? closableMonths(monthsIn(d), current) : monthsIn(d);
  const months = all.slice(-SHOWN);
  const stepMonth = month === "all" ? all[all.length - 1] : month;
  const closedSet = new Set(closes.ready ? closes.value.filter((c) => c.closed).map((c) => c.month) : []);
  const steps = booksSteps(
    d,
    stepMonth,
    { gapAnswers: gaps.ready ? gaps.value : undefined, pettyCounts: counts.ready ? counts.value : undefined },
    closedSet.has(stepMonth),
  );

  return (
    <div className="books-bar">
      <nav className="month-picker" aria-label="Month">
        {months.map((m) => (
          <Link key={m} href={`${active}?month=${m}`} className={m === month ? "active" : ""} scroll={false}>
            {closedSet.has(m) ? "🔒 " : ""}
            {monthLabel(m)}
          </Link>
        ))}
      </nav>
      <nav className="steps" aria-label={`Steps for ${monthLabel(stepMonth)}`}>
        {steps.map((s, i) => (
          <Link
            key={s.href}
            href={`${s.href}?month=${stepMonth}`}
            className={`${s.href === active ? "active" : ""} ${s.state === "done" ? "done" : s.state === "todo" && s.hint ? "todo" : ""}`}
            aria-current={s.href === active ? "page" : undefined}
          >
            <span className="n">{s.state === "done" ? "✓" : i + 1}</span>
            {s.label}
            {s.state !== "done" && s.hint ? <small>{s.hint}</small> : null}
          </Link>
        ))}
      </nav>
    </div>
  );
}
