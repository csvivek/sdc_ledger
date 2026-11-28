import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { getStore } from "@/lib/data/store";
import { cardDaysOverdue, inr, monthLabel, monthsIn, monthsWithData, pnl, SHARED_SPLIT, todayInIndia } from "@/lib/calc";
import { shouldShowCharts } from "@/lib/trend";
import { CLINIC_LABEL } from "@/lib/types";
import { MonthPicker, pickMonth } from "@/components/MonthPicker";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { resetDemoData } from "../actions";
import { getExtras } from "@/lib/data/extras";
import { backupAgeText, backupStatus } from "@/lib/backup";
import { forecast } from "@/lib/forecast";
import { ForecastSection } from "@/components/ForecastSection";
import { closableMonths } from "@/lib/month-close";
import { booksSteps } from "@/lib/books";
import { monthItems, toAddAll } from "@/lib/recurring";

export const dynamic = "force-dynamic";

const SCOPES = [
  ["SDC1", CLINIC_LABEL.SDC1],
  ["SDC2", CLINIC_LABEL.SDC2],
  ["ALL", "Combined"],
] as const;

type Todo = { text: string; where: string; href: string; bad?: boolean };

export default async function HomePage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  await requireAdmin();
  const x = getExtras();
  const [d, backups, gaps, counts, closes, templates] = await Promise.all([
    getStore().read(),
    x.listBackups(1),
    x.gapAnswers(),
    x.pettyCounts(),
    x.listCloses(),
    x.listTemplates(),
  ]);
  const months = monthsIn(d);
  const month = pickMonth(months, (await searchParams).month);
  const today = todayInIndia();
  const thisMonth = today.slice(0, 7);

  // What needs the admin, each with a link to where it is fixed.
  const todo: Todo[] = [];
  const unknown = d.bankTxns.filter((t) => t.kind === "UNKNOWN_OUT").length;
  if (unknown) todo.push({ text: `${unknown} bank payment${unknown === 1 ? "" : "s"} need a category`, where: "Books › Reconcile", href: "/reconciliation", bad: true });

  // The last month that is over: its books, step by step.
  const closable = closableMonths(months, thisMonth);
  const booksMonth = closable[closable.length - 1];
  const closedSet = new Set(closes.ready ? closes.value.filter((c) => c.closed).map((c) => c.month) : []);
  if (booksMonth && !closedSet.has(booksMonth)) {
    const steps = booksSteps(
      d,
      booksMonth,
      { gapAnswers: gaps.ready ? gaps.value : undefined, pettyCounts: counts.ready ? counts.value : undefined },
      false,
    );
    const label = monthLabel(booksMonth);
    for (const s of steps) {
      for (const item of s.open) {
        // Bank categories and card money are listed once for all months.
        if (item.key === "categorised" || item.key === "cards") continue;
        todo.push({ text: item.detail, where: `${label} · Books › ${s.label}`, href: `${s.href}?month=${booksMonth}` });
      }
    }
    if (closes.ready) todo.push({ text: `Close ${label}`, where: "Books › Close", href: `/month-close?month=${booksMonth}` });
  }

  const pendingCards = d.cardPayments.filter((c) => !c.creditedOn);
  const overdueCard = pendingCards.filter((c) => cardDaysOverdue(c.date, today) > 0).reduce((s, c) => s + c.amount, 0);
  if (overdueCard > 0) todo.push({ text: `${inr(overdueCard)} of card income is overdue`, where: "Still with the doctor · Books › Card income", href: "/card-income", bad: true });

  if (templates.ready) {
    const left = toAddAll(monthItems(templates.value, thisMonth, d.expenses)).length;
    if (left) todo.push({ text: `${left} recurring expense${left === 1 ? "" : "s"} not added for ${monthLabel(thisMonth)}`, where: "Add expense", href: "/expenses#recurring" });
  }

  const backup = backups.ready ? backupStatus(backups.value[0]?.takenAt) : undefined;
  if (backup?.due) todo.push({ text: backupAgeText(backup), where: "Settings › Backup", href: "/backup" });

  const monthsOfData = monthsWithData(d).length;
  const fc = forecast(d, "ALL", thisMonth);

  return (
    <>
      <h1>Home</h1>

      <h2>Needs you ({todo.length})</h2>
      <div className="card todo-list">
        {todo.length === 0 && <div className="all-done">✓ Nothing needs you right now.</div>}
        {todo.map((t) => (
          <Link key={t.href + t.text} href={t.href}>
            <span className={`sev ${t.bad ? "bad" : ""}`} aria-hidden="true" />
            <span className="t">
              <b>{t.text}</b>
              <span>{t.where}</span>
            </span>
            <span className="go" aria-hidden="true">›</span>
          </Link>
        ))}
      </div>

      <h2>Profit, {monthLabel(month)}</h2>
      <MonthPicker months={months} active={month} basePath="/dashboard" />
      <div className="grid">
        {SCOPES.map(([k, label]) => {
          const p = pnl(d, month, k);
          return (
            <div key={k} className="card stat">
              <div className="label">{label}</div>
              <div className={`value ${p.profit >= 0 ? "pos" : "neg"}`}>{inr(p.profit)}</div>
              <div className="muted">
                Income {inr(p.income)} · Expenses {inr(p.expenses)}
              </div>
            </div>
          );
        })}
      </div>
      <p className="muted">
        Income is PappyJoe cash + UPI + card. Expenses are portal entries plus categorised bank payments nobody entered in the portal; petty cash withdrawals are transfers, not expenses, and bank payments still waiting for an answer are left out. Shared expenses are split{" "}
        {SHARED_SPLIT.SDC1 * 100}/{SHARED_SPLIT.SDC2 * 100} between clinics (mock rule, to confirm). Trends and analysis are in{" "}
        <Link href="/reports">Reports</Link>.
      </p>

      <ForecastSection
        combined={fc}
        clinics={{ SDC1: forecast(d, "SDC1", thisMonth), SDC2: forecast(d, "SDC2", thisMonth) }}
        history={fc.basedOn.map((m) => ({ month: m, profit: pnl(d, m, "ALL").profit }))}
        chartsOn={shouldShowCharts(monthsOfData)}
        sample={false}
        currentMonth={thisMonth}
      />

      {!isSupabaseConfigured && (
        <form action={resetDemoData} style={{ marginTop: 24 }}>
          <button type="submit" className="secondary small">Reset demo data</button>{" "}
          <span className="muted">Puts the fake seed data back and removes anything entered.</span>
        </form>
      )}
    </>
  );
}
