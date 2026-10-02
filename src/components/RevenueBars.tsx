"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/money";

/**
 * 30 days of gross revenue as bars with a 7-day average line. The best day is
 * picked out in lime. Each bar has a hover/focus readout, and the same numbers
 * are available as a table.
 */
export function RevenueBars({ days, currency }: { days: { date: string; amount: number }[]; currency: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const max = Math.max(1, ...days.map((d) => d.amount));
  const top = max * 1.08;
  const label = (d: { date: string }) => new Date(`${d.date}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
  const h = hover === null ? null : days[hover];
  const total = days.reduce((n, d) => n + d.amount, 0);
  const best = days.reduce((b, d, i) => (d.amount > days[b].amount ? i : b), 0);
  const avg = days.map((_, i) => {
    const w = days.slice(Math.max(0, i - 6), i + 1);
    return w.reduce((n, d) => n + d.amount, 0) / w.length;
  });
  const n = days.length;
  const points = avg.map((v, i) => `${((i + 0.5) / n) * 100},${100 - (v / top) * 100}`).join(" ");
  const ticks = [0, 7, 14, 21, n - 1].filter((i) => i < n);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span className="font-mono tabular-nums text-ink">{h ? `${label(h)} · ${formatMoney(h.amount, currency)} · 7-day avg ${formatMoney(Math.round(avg[hover!]), currency)}` : `Peak ${formatMoney(max === 1 ? 0 : max, currency)}`}</span>
        <button type="button" onClick={() => setTable((t) => !t)} className="hud-label min-h-10 text-[11px] text-cyan hover:underline sm:min-h-0">{table ? "Show chart" : "Show as table"}</button>
      </div>
      {table ? (
        <div className="max-h-64 overflow-y-auto">
          <table className="w-full text-sm">
            <thead><tr><th className="hud-label py-1 text-left text-[11px] text-muted">Day</th><th className="hud-label py-1 text-right text-[11px] text-muted">Gross</th></tr></thead>
            <tbody>{days.map((d) => <tr key={d.date} className="border-t border-line/60"><td className="py-1.5">{label(d)}</td><td className="py-1.5 text-right font-mono tabular-nums">{formatMoney(d.amount, currency)}</td></tr>)}</tbody>
          </table>
        </div>
      ) : (
        <>
          <div className="relative h-44 sm:h-52" style={{ backgroundImage: "linear-gradient(rgb(63 208 255 / 0.1) 1px, transparent 1px)", backgroundSize: "100% 25%" }}>
            <div className="absolute inset-0 flex items-end gap-[2px] border-b border-line sm:gap-[3px]" role="img" aria-label={`Daily gross revenue for the last 30 days, peak ${formatMoney(max, currency)}`} onMouseLeave={() => setHover(null)}>
              {days.map((d, i) => (
                <button
                  key={d.date}
                  type="button"
                  aria-label={`${label(d)}: ${formatMoney(d.amount, currency)}`}
                  onMouseEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  className="group flex h-full flex-1 items-end outline-none"
                >
                  <span
                    className="block w-full transition-opacity group-focus-visible:outline group-focus-visible:outline-cyan"
                    style={{
                      height: d.amount ? `${Math.max(1.5, (d.amount / top) * 100)}%` : "0",
                      background: i === best && d.amount ? "#c6f432" : "linear-gradient(180deg, #3df5a0, rgb(46 242 208 / 0.15))",
                      boxShadow: i === best && d.amount ? "0 0 10px rgb(198 244 50 / 0.5)" : undefined,
                      opacity: hover === null || hover === i ? 1 : 0.55,
                    }}
                  />
                </button>
              ))}
            </div>
            <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
              <polyline points={points} fill="none" stroke="#ffd84d" strokeWidth="2" vectorEffect="non-scaling-stroke" style={{ filter: "drop-shadow(0 0 3px #ffd84d)" }} />
            </svg>
          </div>
          <div className="relative mt-1.5 h-4 font-display text-[11px] uppercase tracking-[0.1em] text-muted">
            {ticks.map((i, k) => (
              <span key={i} className={`absolute ${k === 0 ? "left-0" : k === ticks.length - 1 ? "right-0" : "-translate-x-1/2 max-sm:hidden"}`} style={k === 0 || k === ticks.length - 1 ? undefined : { left: `${((i + 0.5) / n) * 100}%` }}>{label(days[i])}</span>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#c5d3de]">
            <span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 bg-emerald" />Daily gross</span>
            <span className="inline-flex items-center gap-1.5"><i className="h-0.5 w-3 bg-gold" />7-day average</span>
            {total > 0 && <span className="text-muted">Best day {label(days[best])} · {formatMoney(days[best].amount, currency)} · avg {formatMoney(Math.round(total / n), currency)}/day</span>}
          </div>
        </>
      )}
    </div>
  );
}
