"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/money";
import { SYS } from "@/components/ui";

/**
 * 30 days of gross revenue as bars with a 7-day average line. The best day is
 * picked out in a deeper blue. Each bar has a hover/focus readout, and the same
 * numbers are available as a table.
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
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-[13px] text-muted">
        <span className="tabular-nums text-ink">{h ? `${label(h)} · ${formatMoney(h.amount, currency)} · 7-day avg ${formatMoney(Math.round(avg[hover!]), currency)}` : `Peak ${formatMoney(max === 1 ? 0 : max, currency)}`}</span>
        <button type="button" onClick={() => setTable((t) => !t)} className="min-h-10 text-[13px] text-cyan hover:underline sm:min-h-0">{table ? "Show chart" : "Show as table"}</button>
      </div>
      {table ? (
        <div className="max-h-64 overflow-y-auto">
          <table className="w-full text-[15px]">
            <thead><tr><th className="py-1 text-left text-[12px] font-medium text-muted">Day</th><th className="py-1 text-right text-[12px] font-medium text-muted">Gross</th></tr></thead>
            <tbody>{days.map((d) => <tr key={d.date} className="border-t border-line"><td className="py-1.5 text-ink">{label(d)}</td><td className="py-1.5 text-right tabular-nums text-ink">{formatMoney(d.amount, currency)}</td></tr>)}</tbody>
          </table>
        </div>
      ) : (
        <>
          <div className="relative h-44 sm:h-52" style={{ backgroundImage: "linear-gradient(var(--color-line) 1px, transparent 1px)", backgroundSize: "100% 25%" }}>
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
                    className="block w-full rounded-t-[3px] transition-opacity group-focus-visible:outline-2 group-focus-visible:outline-cyan"
                    style={{
                      height: d.amount ? `${Math.max(1.5, (d.amount / top) * 100)}%` : "0",
                      background: i === best && d.amount ? SYS.blue : `color-mix(in srgb, ${SYS.blue} 55%, transparent)`,
                      opacity: hover === null || hover === i ? 1 : 0.5,
                    }}
                  />
                </button>
              ))}
            </div>
            <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
              <polyline points={points} fill="none" stroke="var(--color-ink)" strokeOpacity={0.55} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            </svg>
          </div>
          <div className="relative mt-1.5 h-4 text-[12px] text-muted">
            {ticks.map((i, k) => (
              <span key={i} className={`absolute whitespace-nowrap ${k === 0 ? "left-0" : k === ticks.length - 1 ? "right-0" : "-translate-x-1/2 max-sm:hidden"}`} style={k === 0 || k === ticks.length - 1 ? undefined : { left: `${((i + 0.5) / n) * 100}%` }}>{label(days[i])}</span>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-ink">
            <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-[3px]" style={{ background: SYS.blue }} />Daily gross</span>
            <span className="inline-flex items-center gap-1.5"><i className="h-0.5 w-3.5 rounded-full bg-ink/55" />7-day average</span>
            {total > 0 && <span className="text-muted">Best day {label(days[best])} · {formatMoney(days[best].amount, currency)} · avg {formatMoney(Math.round(total / n), currency)}/day</span>}
          </div>
        </>
      )}
    </div>
  );
}
