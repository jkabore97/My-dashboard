import type { Website } from "@/lib/types";
import { bucketStatus, pctLabel, uptimePct } from "@/components/web/logic";

export interface UptimePoint {
  status: Website["status"];
  responseMs: number | null;
  takenAt: string;
}

const TONE: Record<Website["status"], string> = {
  up: "var(--color-lime)",
  degraded: "var(--color-high)",
  down: "var(--color-critical)",
  unknown: "var(--color-fill-2)",
};

/**
 * A window of checks as ticks (default: 24 hours in 48 half-hour ticks); each
 * tick shows the worst status seen in its slot. Status is never color alone:
 * every tick has a tooltip and the uptime percentage is printed beside it.
 */
export function UptimeStrip({ points, hours = 24, buckets = 48, showPct = true, now = Date.now(), className = "" }: { points: UptimePoint[]; hours?: number; buckets?: number; showPct?: boolean; now?: number; className?: string }) {
  if (points.length === 0) return <span className="text-[13px] text-muted">No checks yet</span>;
  const end = now;
  const start = end - hours * 3_600_000;
  const inWindow = points.filter((p) => Date.parse(p.takenAt) >= start);
  const ticks = bucketStatus(inWindow, start, end, buckets);
  const pct = uptimePct(inWindow);
  const fmt = (t: number) =>
    hours > 48 ? new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : new Date(t).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return (
    <div className={`flex min-w-0 items-center gap-3 ${className}`}>
      <div className="flex h-[18px] min-w-0 flex-1 items-end gap-px sm:gap-[2px]" role="img" aria-label={pct == null ? `No checks in the last ${hours} hours` : `Uptime ${pctLabel(pct)} over ${hours} hours`}>
        {ticks.map((s, i) => {
          const from = start + (i * (end - start)) / buckets;
          return (
            <span
              key={i}
              title={`${fmt(from)}: ${s ?? "no check"}`}
              className="block min-w-px flex-1 rounded-[1.5px]"
              style={s ? { height: "100%", background: TONE[s] } : { height: "100%", background: "var(--color-fill)" }}
            />
          );
        })}
      </div>
      {showPct && <span className={`w-14 shrink-0 text-right text-[13px] font-medium tabular-nums ${pct === 100 ? "text-ok" : "text-ink"}`}>{pct == null ? "—" : pctLabel(pct)}</span>}
    </div>
  );
}
