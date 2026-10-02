"use client";

import { useEffect, useState } from "react";

export interface ClockZone {
  label: string;
  timeZone: string;
}

/** Live local times for a few places. Rendered after mount so server and browser agree. */
export function Clocks({ zones, compact = false }: { zones: ClockZone[]; compact?: boolean }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);
  const fmt = (tz: string, opts: Intl.DateTimeFormatOptions) => {
    try {
      return now ? new Intl.DateTimeFormat("en-US", { timeZone: tz, ...opts }).format(now) : "--:--";
    } catch {
      return "?";
    }
  };
  if (compact) {
    return (
      <span className="flex gap-3 text-xs tabular-nums text-muted" aria-label="Local times">
        {zones.map((z) => <span key={z.timeZone}>{z.label} <span className="text-ink">{fmt(z.timeZone, { hour: "numeric", minute: "2-digit" })}</span></span>)}
      </span>
    );
  }
  return (
    <div className="grid gap-1.5" aria-label="Local times">
      {zones.map((z) => (
        <div key={z.timeZone} className="flex items-baseline justify-between gap-2">
          <span className="text-xs text-muted">{z.label}</span>
          <span className="tabular-nums">
            <span className="text-sm font-medium">{fmt(z.timeZone, { hour: "numeric", minute: "2-digit" })}</span>
            <span className="ml-1.5 text-[11px] text-muted">{fmt(z.timeZone, { weekday: "short" })}</span>
          </span>
        </div>
      ))}
    </div>
  );
}
