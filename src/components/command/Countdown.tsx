"use client";

import { useEffect, useState } from "react";

/** Minutes (or hours) until a time, ticking every 20 seconds. Shows "now" once it has started. */
export function Countdown({ to, until }: { to: string; until?: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 20_000);
    return () => clearInterval(t);
  }, []);
  const start = Date.parse(to);
  const t = now ?? start;
  const live = t >= start && (!until || t < Date.parse(until));
  const mins = Math.max(0, Math.round((start - t) / 60_000));
  const [value, unit] = now === null ? ["--", "minutes"] : live ? ["NOW", "in progress"] : mins >= 120 ? [String(Math.round(mins / 60)), "hours"] : [String(mins), mins === 1 ? "minute" : "minutes"];
  return (
    <div className="text-center" aria-live="polite">
      <div className="hud-num text-[44px] leading-none" style={{ "--c1": "#eaf7ff", "--c2": "#9be7ff" } as React.CSSProperties}>{value}</div>
      <div className="hud-label mt-2 text-[10.5px] text-muted">{unit}</div>
    </div>
  );
}
