import Link from "next/link";
import { monthLabel } from "@/lib/calc";

export function MonthPicker({ months, active, basePath }: { months: string[]; active: string; basePath: string }) {
  return (
    <div className="month-picker">
      {months.map((m) => (
        <Link key={m} href={`${basePath}?month=${m}`} className={m === active ? "active" : ""}>
          {monthLabel(m)}
        </Link>
      ))}
    </div>
  );
}

export function pickMonth(months: string[], requested: string | undefined) {
  return requested && months.includes(requested) ? requested : months[months.length - 1];
}
