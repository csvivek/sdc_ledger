"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { axisMonth, compactInr, niceTicks } from "@/lib/trend";
import { inr, monthLabel } from "@/lib/calc";

export interface ChartSeries {
  name: string;
  /** A CSS colour, normally one of the --series-* variables. */
  color: string;
  values: number[];
}

interface Props {
  title: string;
  kind: "bar" | "line";
  months: string[];
  series: ChartSeries[];
  /** One extra line per month for the readout, e.g. "Profit ₹1,20,000". */
  notes?: string[];
}

const H = 190; // plot height
const M = { top: 10, right: 8, bottom: 36, left: 46 };

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

export function TrendChart({ title, kind, months, series, notes }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(340);
  const [sel, setSel] = useState(months.length - 1);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(240, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = months.length;
  const all = series.flatMap((s) => s.values);
  const ticks = niceTicks(Math.min(...all), Math.max(...all));
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  const plotW = width - M.left - M.right;
  const y = (v: number) => M.top + H - ((v - lo) / (hi - lo || 1)) * H;
  const gw = plotW / n;
  const cx = (i: number) => M.left + gw * i + gw / 2;
  const y0 = y(0);
  const ns = series.length;
  const gap = 2;
  const barW = Math.max(3, Math.min(18, (gw * 0.72 - gap * (ns - 1)) / ns));
  const groupW = barW * ns + gap * (ns - 1);
  // Thin out the month labels when they would collide (about 30px each).
  const labelEvery = gw >= 30 ? 1 : gw >= 15 ? 2 : 3;

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowLeft") setSel((s) => Math.max(0, s - 1));
    else if (e.key === "ArrowRight") setSel((s) => Math.min(n - 1, s + 1));
    else return;
    e.preventDefault();
  };

  return (
    <figure className="chart card">
      <figcaption className="chart-title">{title}</figcaption>
      <div className="chart-readout" aria-live="polite">
        <strong>{monthLabel(months[sel])}</strong>
        <ul>
          {series.map((s) => (
            <li key={s.name}>
              <span className={`chart-key ${kind}`} style={{ background: s.color }} aria-hidden />
              <span className="chart-key-name">{s.name}</span>
              <span className={`chart-key-value ${s.values[sel] < 0 ? "neg" : ""}`}>{inr(s.values[sel])}</span>
            </li>
          ))}
        </ul>
        {notes?.[sel] && <div className="muted">{notes[sel]}</div>}
      </div>
      <div
        ref={wrap}
        className="chart-plot"
        tabIndex={0}
        onKeyDown={onKey}
        aria-label={`${title}. Tap a month, or use the left and right arrow keys, to see its numbers.`}
      >
        <svg width={width} height={M.top + H + M.bottom} role="img" aria-label={title}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={width - M.right} y1={y(t)} y2={y(t)} className={t === 0 ? "chart-zero" : "chart-gridline"} />
              <text x={M.left - 6} y={y(t)} dy="0.32em" textAnchor="end" className="chart-axis">
                {compactInr(t)}
              </text>
            </g>
          ))}

          {sel >= 0 && <rect x={M.left + gw * sel} y={M.top} width={gw} height={H} className="chart-sel" rx={6} />}

          {kind === "bar" &&
            series.map((s, si) =>
              s.values.map((v, i) => (
                <path key={`${si}-${i}`} d={barPath(cx(i) - groupW / 2 + si * (barW + gap), barW, y(v), y0)} fill={s.color} />
              )),
            )}

          {kind === "line" &&
            series.map((s) => (
              <g key={s.name}>
                <path
                  d={s.values.map((v, i) => `${i ? "L" : "M"}${cx(i)},${y(v)}`).join("")}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
                {s.values.map((v, i) => (
                  <circle key={i} cx={cx(i)} cy={y(v)} r={i === sel ? 5 : 4} fill={s.color} className="chart-dot" />
                ))}
              </g>
            ))}

          {months.map((m, i) => {
            const show = (n - 1 - i) % labelEvery === 0;
            const lab = axisMonth(m, i === 0);
            return (
              show && (
                <text key={m} x={cx(i)} y={M.top + H + 16} textAnchor="middle" className={`chart-axis ${i === sel ? "on" : ""}`}>
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
    </figure>
  );
}
