import Link from "next/link";
import { monthLabel } from "@/lib/calc";

/** `allTime` adds an "All time" chip that links to ?month=all. */
export function MonthPicker({
  months,
  active,
  basePath,
  allTime = false,
}: {
  months: string[];
  active: string;
  basePath: string;
  allTime?: boolean;
}) {
  return (
    <div className="month-picker">
      {months.map((m) => (
        <Link key={m} href={`${basePath}?month=${m}`} className={m === active ? "active" : ""}>
          {monthLabel(m)}
        </Link>
      ))}
      {allTime && (
        <Link href={`${basePath}?month=all`} className={active === "all" ? "active" : ""}>
          All time
        </Link>
      )}
    </div>
  );
}

export function pickMonth(months: string[], requested: string | undefined) {
  return requested && months.includes(requested) ? requested : months[months.length - 1];
}
