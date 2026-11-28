"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { monthLabel } from "@/lib/calc";
import { entriesHref, type ClinicFilter, type EntriesView } from "@/lib/expense-view";
import type { MonthKey } from "@/lib/types";

/**
 * "Latest entries" or one month: a dropdown of months plus older / newer arrows.
 * The arrows are plain links, so they work before the page's script loads.
 */
export function EntriesMonthNav({ view, months, clinic }: { view: EntriesView; months: MonthKey[]; clinic: ClinicFilter }) {
  const router = useRouter();
  // months is newest first.
  const i = view === "latest" ? -1 : months.indexOf(view);
  const older = view === "latest" ? months[0] : months[i + 1];
  const newer = view === "latest" ? undefined : i === 0 ? "latest" : months[i - 1];

  return (
    <div className="entries-nav">
      {older ? (
        <Link className="arrow" href={entriesHref(older, clinic)} aria-label={`Show ${monthLabel(older)}`} scroll={false}>
          ‹
        </Link>
      ) : (
        <span className="arrow off" aria-hidden="true">‹</span>
      )}
      <select
        aria-label="Show entries for"
        value={view}
        onChange={(e) => router.push(entriesHref(e.target.value as EntriesView, clinic), { scroll: false })}
      >
        <option value="latest">Latest entries</option>
        {months.map((m) => (
          <option key={m} value={m}>
            {monthLabel(m)}
          </option>
        ))}
      </select>
      {newer ? (
        <Link
          className="arrow"
          href={entriesHref(newer, clinic)}
          aria-label={newer === "latest" ? "Show latest entries" : `Show ${monthLabel(newer)}`}
          scroll={false}
        >
          ›
        </Link>
      ) : (
        <span className="arrow off" aria-hidden="true">›</span>
      )}
    </div>
  );
}
