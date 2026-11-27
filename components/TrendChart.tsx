"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { axisMonth, CHART_WINDOW_MONTHS, compactInr, niceTicks, sameMonthLastYear, windowStart, yoyChangePct } from "@/lib/trend";
import { inr, monthLabel } from "@/lib/calc";

export interface ChartSeries {
  name: string;
  /** A CSS colour, normally one of the --series-* variables. */
  color: string;
  values: number[];
}

interface Props {
  /** Stable name for remembering this chart's switches on this phone or computer. */
  id: string;
  title: string;
  kind: "bar" | "line";
  /** Every month of history, oldest first. The chart shows the latest 12 unless "All" is switched on. */
  months: string[];
  series: ChartSeries[];
  /** One extra line per month for the readout, e.g. "Profit ₹1,20,000". Same order as months. */
  notes?: string[];
  /** How values read: rupees (default), whole counts, or numbers with one decimal (e.g. visits per day). */
  format?: "inr" | "count" | "decimal";
}

interface Prefs {
  /** Show the same month last year next to this year. */
  yoy: boolean;
  /** Show every month instead of the latest 12. */
  all: boolean;
}

const H = 190; // plot height
const M = { top: 10, right: 8, bottom: 36, left: 46 };
const LAST_YEAR_OPACITY = 0.38;

/** Bar path with 4px rounded corners on the data end only, flat on the zero line. */
function barPath(x: number, w: number, yVal: number, yZero: number) {
  const h = Math.abs(yZero - yVal);
  const r = Math.min(4, w / 2, h);
  if (h < 0.5) return "";
  if (yVal <= yZero) {
    // grows up
    return `M${x},${yZero}V${yVal + r}Q${x},${yVal} ${x + r},${yVal}H${x + w - r}Q${x + w},${yVal} ${x + w},${yVal + r}V${yZero}Z`;
  }
  return `M${x},${yZero}V${yVal - r}Q${x},${yVal} ${x + r},${yVal}H${x + w - r}Q${x + w},${yVal} ${x + w},${yVal - r}V${yZero}Z`;
}

function usePrefs(id: string): [Prefs, (p: Partial<Prefs>) => void] {
  const key = `sdc.chart.${id}`;
  const [prefs, setPrefs] = useState<Prefs>({ yoy: false, all: false });
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? "null");
      if (saved && typeof saved === "object") setPrefs({ yoy: saved.yoy === true, all: saved.all === true });
    } catch {
      // storage blocked or bad value: keep the defaults
    }
  }, [key]);
  const update = (p: Partial<Prefs>) =>
    setPrefs((old) => {
      const next = { ...old, ...p };
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  return [prefs, update];
}

export function TrendChart({ id, title, kind, months: allMonths, series: allSeries, notes: allNotes, format = "inr" }: Props) {
  const full = (v: number) => (format === "inr" ? inr(v) : format === "count" ? Math.round(v).toLocaleString("en-IN") : (Math.round(v * 10) / 10).toString());
  const axis = (v: number) => (format === "inr" ? compactInr(v) : v.toLocaleString("en-IN"));

  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(340);
  const [prefs, setPref] = usePrefs(id);

  // Which months show: the latest 12 by default, all of them when asked.
  const hasOlder = allMonths.length > CHART_WINDOW_MONTHS;
  const start = windowStart(allMonths.length, prefs.all && hasOlder);
  const months = allMonths.slice(start);
  const series = allSeries.map((s) => ({ ...s, values: s.values.slice(start) }));
  const notes = allNotes?.slice(start);
  const n = months.length;

  // Same month last year, looked up in the full history so the first months shown still get one.
  const lastYear = allSeries.map((s) => sameMonthLastYear(allMonths, s.values, months));
  const hasLastYear = lastYear.some((vs) => vs.some((v) => v !== null));
  const yoy = prefs.yoy && hasLastYear;

  const [sel, setSel] = useState(n - 1);
  useEffect(() => setSel(n - 1), [n, start]);
  const s0 = Math.min(Math.max(0, sel), n - 1);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(240, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // With many months, keep each month tappable and let the plot scroll sideways instead of squashing it.
  const marksPerMonth = kind === "bar" ? series.length * (yoy ? 2 : 1) : 1;
  const minGroup = Math.max(20, marksPerMonth * 4 + 6);
  const svgW = Math.max(width, M.left + M.right + n * minGroup);
  useEffect(() => {
    const el = wrap.current;
    if (el) el.scrollLeft = el.scrollWidth; // the latest month is on the right
  }, [svgW, n]);

  const plotted = [...series.flatMap((s) => s.values), ...(yoy ? lastYear.flat().filter((v): v is number => v !== null) : [])];
  const ticks = niceTicks(Math.min(...plotted), Math.max(...plotted));
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  const plotW = svgW - M.left - M.right;
  const y = (v: number) => M.top + H - ((v - lo) / (hi - lo || 1)) * H;
  const gw = plotW / n;
  const cx = (i: number) => M.left + gw * i + gw / 2;
  const y0 = y(0);
  const gap = 2;
  const barW = Math.max(3, Math.min(18, (gw * 0.72 - gap * (marksPerMonth - 1)) / marksPerMonth));
  const groupW = barW * marksPerMonth + gap * (marksPerMonth - 1);
  // Thin out the month labels when they would collide (about 30px each).
  const labelEvery = gw >= 30 ? 1 : gw >= 15 ? 2 : 3;

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowLeft") setSel(Math.max(0, s0 - 1));
    else if (e.key === "ArrowRight") setSel(Math.min(n - 1, s0 + 1));
    else return;
    e.preventDefault();
  };

  const linePath = (vals: (number | null)[]) => {
    let d = "";
    let pen = false;
    vals.forEach((v, i) => {
      if (v === null) {
        pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${cx(i)},${y(v)}`;
      pen = true;
    });
    return d;
  };

  if (n === 0) return null;

  return (
    <figure className="chart card">
      <figcaption className="chart-title">{title}</figcaption>
      <div className="chart-controls">
        <div className="view-toggle small" role="group" aria-label="Months shown">
          <button type="button" aria-pressed={!prefs.all} className={!prefs.all ? "on" : ""} onClick={() => setPref({ all: false })}>
            12 months
          </button>
          <button
            type="button"
            aria-pressed={prefs.all && hasOlder}
            className={prefs.all && hasOlder ? "on" : ""}
            onClick={() => setPref({ all: true })}
            disabled={!hasOlder}
            title={hasOlder ? undefined : "No older months yet"}
          >
            All {allMonths.length}
          </button>
        </div>
        <label className={`yoy-switch ${hasLastYear ? "" : "off"}`}>
          <input type="checkbox" checked={yoy} disabled={!hasLastYear} onChange={(e) => setPref({ yoy: e.target.checked })} />
          vs last year
        </label>
      </div>
      {!hasLastYear && prefs.yoy && <p className="chart-note">No data for the same months last year yet.</p>}
      {!hasOlder && prefs.all && <p className="chart-note">All {allMonths.length} months are already shown.</p>}
      {svgW > width && <p className="chart-note">Swipe the chart sideways to see older months.</p>}

      <div className="chart-readout" aria-live="polite">
        <strong>{monthLabel(months[s0])}</strong>
        <ul>
          {series.map((s, si) => {
            const ly = lastYear[si][s0];
            const ch = yoyChangePct(s.values[s0], ly);
            return (
              <li key={s.name}>
                <span className={`chart-key ${kind}`} style={{ background: s.color }} aria-hidden />
                <span className="chart-key-name">{s.name}</span>
                <span className={`chart-key-value ${s.values[s0] < 0 ? "neg" : ""}`}>{full(s.values[s0])}</span>
                {yoy && (
                  <span className="chart-yoy">
                    {ly === null ? "· last year: no data" : `· last year ${full(ly)}${ch === null ? "" : ` (${ch >= 0 ? "+" : ""}${ch}%)`}`}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
        {notes?.[s0] && <div className="muted">{notes[s0]}</div>}
        {yoy && (
          <div className="muted chart-legend-yoy">
            <span className={`chart-key ${kind} faded`} aria-hidden /> Paler {kind === "bar" ? "bars" : "dashed lines"} are the same month last year
          </div>
        )}
      </div>
      <div className="chart-body">
      <div
        ref={wrap}
        className="chart-plot"
        tabIndex={0}
        onKeyDown={onKey}
        aria-label={`${title}. Tap a month, or use the left and right arrow keys, to see its numbers.`}
      >
        <svg width={svgW} height={M.top + H + M.bottom} role="img" aria-label={title}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={svgW - M.right} y1={y(t)} y2={y(t)} className={t === 0 ? "chart-zero" : "chart-gridline"} />
            </g>
          ))}

          <rect x={M.left + gw * s0} y={M.top} width={gw} height={H} className="chart-sel" rx={6} />

          {kind === "bar" &&
            series.map((s, si) =>
              s.values.map((v, i) => {
                const slot = yoy ? si * 2 : si;
                const x = cx(i) - groupW / 2 + slot * (barW + gap);
                const ly = lastYear[si][i];
                return (
                  <g key={`${si}-${i}`}>
                    {yoy && ly !== null && <path d={barPath(x, barW, y(ly), y0)} fill={s.color} opacity={LAST_YEAR_OPACITY} />}
                    <path d={barPath(yoy ? x + barW + gap : x, barW, y(v), y0)} fill={s.color} />
                  </g>
                );
              }),
            )}

          {kind === "line" &&
            series.map((s, si) => (
              <g key={s.name}>
                {yoy && (
                  <path
                    d={linePath(lastYear[si])}
                    fill="none"
                    stroke={s.color}
                    strokeOpacity={0.55}
                    strokeWidth={2}
                    strokeDasharray="5 4"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                )}
                <path d={linePath(s.values)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                {s.values.map((v, i) => (
                  <circle key={i} cx={cx(i)} cy={y(v)} r={i === s0 ? 5 : 4} fill={s.color} className="chart-dot" />
                ))}
              </g>
            ))}

          {months.map((m, i) => {
            const show = (n - 1 - i) % labelEvery === 0;
            const lab = axisMonth(m, i === 0);
            return (
              show && (
                <text key={m} x={cx(i)} y={M.top + H + 16} textAnchor="middle" className={`chart-axis ${i === s0 ? "on" : ""}`}>
                  {lab.month}
                  {lab.year && (
                    <tspan x={cx(i)} dy="1.2em">
                      {lab.year}
                    </tspan>
                  )}
                </text>
              )
            );
          })}

          {/* Tap targets: the whole column, much bigger than the marks */}
          {months.map((m, i) => (
            <rect
              key={m}
              x={M.left + gw * i}
              y={0}
              width={gw}
              height={M.top + H + M.bottom}
              fill="transparent"
              onPointerEnter={(e) => e.pointerType === "mouse" && setSel(i)}
              onClick={() => setSel(i)}
            />
          ))}
        </svg>
      </div>
      {/* The amounts axis stays put while the months scroll underneath it. */}
      <svg className="chart-yaxis" width={M.left} height={M.top + H + M.bottom} aria-hidden>
        <rect x={0} y={0} width={M.left} height={M.top + H + M.bottom} className="chart-yaxis-bg" />
        {ticks.map((t) => (
          <text key={t} x={M.left - 6} y={y(t)} dy="0.32em" textAnchor="end" className="chart-axis">
            {axis(t)}
          </text>
        ))}
      </svg>
      </div>
    </figure>
  );
}
