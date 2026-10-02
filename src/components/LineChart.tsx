"use client";

import { useRef, useState } from "react";

/**
 * One series over time: 2px line, recessive grid, crosshair + tooltip on
 * hover/touch, and a table view. Single series, so the card title names it
 * (no legend). Values are formatted by the caller.
 */
export function LineChart({ points, format: formatFn, unit, height = 140, label, axis = "day", timeZone }: { points: { date: string; value: number }[]; format?: (n: number) => string; /** Suffix for values, for server components that can't pass a formatter. */ unit?: string; height?: number; label: string; /** "time": dates are ISO timestamps shown as times. */ axis?: "day" | "time"; timeZone?: string }) {
  const format = formatFn ?? ((n: number) => `${n.toLocaleString()}${unit ? ` ${unit}` : ""}`);
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const ref = useRef<SVGSVGElement>(null);
  if (points.length === 0) return <p className="py-6 text-center text-sm text-muted">No data yet.</p>;

  const W = 600;
  const H = height;
  const pad = { top: 8, bottom: 4 };
  const max = Math.max(1, ...points.map((p) => p.value));
  const x = (i: number) => (points.length === 1 ? W / 2 : (i / (points.length - 1)) * W);
  const y = (v: number) => pad.top + (1 - v / max) * (H - pad.top - pad.bottom);
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const day = (s: string) =>
    axis === "time"
      ? new Date(s).toLocaleTimeString("en-US", { timeZone, hour: "numeric", minute: "2-digit" })
      : new Date(`${s}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
  const h = hover === null ? null : points[hover];

  const onMove = (clientX: number) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const i = Math.round(((clientX - r.left) / r.width) * (points.length - 1));
    setHover(Math.max(0, Math.min(points.length - 1, i)));
  };

  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs text-muted">
        <span className="tabular-nums">{h ? `${day(h.date)}: ${format(h.value)}` : `Peak ${format(max === 1 && points.every((p) => !p.value) ? 0 : max)}`}</span>
        <button type="button" onClick={() => setTable((t) => !t)} className="text-accent hover:underline">{table ? "Show chart" : "Show as table"}</button>
      </div>
      {table ? (
        <div className="max-h-56 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted"><tr><th className="py-1 text-left font-medium">Day</th><th className="py-1 text-right font-medium">{label}</th></tr></thead>
            <tbody>{points.map((p) => <tr key={p.date} className="border-t border-line"><td className="py-1">{day(p.date)}</td><td className="py-1 text-right tabular-nums">{format(p.value)}</td></tr>)}</tbody>
          </table>
        </div>
      ) : (
        <>
          <svg
            ref={ref}
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            className="block w-full touch-none"
            style={{ height: H }}
            role="img"
            aria-label={`${label} over ${points.length} days, peak ${format(max)}`}
            onMouseMove={(e) => onMove(e.clientX)}
            onTouchMove={(e) => onMove(e.touches[0].clientX)}
            onMouseLeave={() => setHover(null)}
            onTouchEnd={() => setHover(null)}
          >
            {[0.25, 0.5, 0.75].map((f) => <line key={f} x1={0} x2={W} y1={y(max * f)} y2={y(max * f)} className="stroke-line" strokeWidth={1} vectorEffect="non-scaling-stroke" />)}
            <line x1={0} x2={W} y1={H - pad.bottom} y2={H - pad.bottom} className="stroke-line" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            <path d={d} fill="none" className="stroke-accent" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            {hover !== null && (
              <>
                <line x1={x(hover)} x2={x(hover)} y1={0} y2={H} className="stroke-muted" strokeWidth={1} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
                <circle cx={x(hover)} cy={y(points[hover].value)} r={4} className="fill-accent stroke-panel" strokeWidth={2} vectorEffect="non-scaling-stroke" />
              </>
            )}
          </svg>
          <div className="mt-1 flex justify-between text-[11px] text-muted"><span>{day(points[0].date)}</span><span>{day(points[points.length - 1].date)}</span></div>
        </>
      )}
    </div>
  );
}

/** Tiny trend line for list rows: no axes, no interaction; the number beside it carries the value. */
export function Sparkline({ points, width = 96, height = 24 }: { points: { value: number }[]; width?: number; height?: number }) {
  if (points.length < 2) return null;
  const max = Math.max(1, ...points.map((p) => p.value));
  const d = points.map((p, i) => `${i ? "L" : "M"}${((i / (points.length - 1)) * width).toFixed(1)},${(2 + (1 - p.value / max) * (height - 4)).toFixed(1)}`).join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" className="shrink-0">
      <path d={d} fill="none" className="stroke-accent" strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}
