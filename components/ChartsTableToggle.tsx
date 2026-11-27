"use client";

import { useEffect, useState, type ReactNode } from "react";

type View = "charts" | "table";
const KEY = "sdc.trendView";

/** Charts / Table switch. Both views are rendered; the choice is remembered on this phone or computer. */
export function ChartsTableToggle({ charts, table }: { charts: ReactNode; table: ReactNode }) {
  const [view, setView] = useState<View>("charts");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved === "charts" || saved === "table") setView(saved);
    } catch {
      // storage blocked: keep the default
    }
  }, []);

  const choose = (v: View) => {
    setView(v);
    try {
      localStorage.setItem(KEY, v);
    } catch {
      // ignore
    }
  };

  return (
    <>
      <div className="view-toggle" role="group" aria-label="Show as">
        {(["charts", "table"] as const).map((v) => (
          <button key={v} type="button" aria-pressed={view === v} className={view === v ? "on" : ""} onClick={() => choose(v)}>
            {v === "charts" ? "Charts" : "Table"}
          </button>
        ))}
      </div>
      <div hidden={view !== "charts"}>{charts}</div>
      <div hidden={view !== "table"}>{table}</div>
    </>
  );
}
