"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/money";

/**
 * 30 days of gross revenue as thin bars (one series, so no legend: the card
 * title names it). Each bar has a hover/focus tooltip, and the same numbers
 * are available as a table.
 */
export function RevenueBars({ days, currency }: { days: { date: string; amount: number }[]; currency: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const max = Math.max(1, ...days.map((d) => d.amount));
  const label = (d: { date: string }) => new Date(`${d.date}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
  const h = hover === null ? null : days[hover];

  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-xs text-muted">
        <span className="tabular-nums">{h ? `${label(h)}: ${formatMoney(h.amount, currency)}` : `Peak ${formatMoney(max === 1 ? 0 : max, currency)}`}</span>
        <button type="button" onClick={() => setTable((t) => !t)} className="text-accent hover:underline">{table ? "Show chart" : "Show as table"}</button>
      </div>
      {table ? (
        <div className="max-h-56 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted"><tr><th className="py-1 text-left font-medium">Day</th><th className="py-1 text-right font-medium">Gross</th></tr></thead>
            <tbody>{days.map((d) => <tr key={d.date} className="border-t border-line"><td className="py-1">{label(d)}</td><td className="py-1 text-right tabular-nums">{formatMoney(d.amount, currency)}</td></tr>)}</tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          <div className="flex h-36 items-end gap-[2px] border-b border-line" role="img" aria-label={`Daily gross revenue for the last 30 days, peak ${formatMoney(max, currency)}`} onMouseLeave={() => setHover(null)}>
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
                  className={`block w-full rounded-t-[4px] transition-colors ${hover === i ? "bg-accent" : "bg-accent/60 group-focus-visible:bg-accent"}`}
                  style={{ height: d.amount ? `${Math.max(2, (d.amount / max) * 100)}%` : "0" }}
                />
              </button>
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[11px] text-muted"><span>{label(days[0])}</span><span>{label(days[days.length - 1])}</span></div>
        </div>
      )}
    </div>
  );
}
