import type { Website } from "@/lib/types";
import { bucketStatus, pctLabel, uptimePct } from "@/components/web/logic";

export interface UptimePoint {
  status: Website["status"];
  responseMs: number | null;
  takenAt: string;
}

const TONE: Record<Website["status"], string> = {
  up: "linear-gradient(180deg, rgb(61 245 160 / 0.85), rgb(46 242 208 / 0.3))",
  degraded: "#ff9f1c",
  down: "#ff3d6e",
  unknown: "#5e7a8f",
};
const GLOW: Partial<Record<Website["status"], string>> = { degraded: "0 0 6px #ff9f1c", down: "0 0 6px #ff3d6e" };

/**
 * A window of checks as ticks (default: 24 hours in 48 half-hour ticks); each
 * tick shows the worst status seen in its slot. Status is never color alone:
 * every tick has a tooltip and the uptime percentage is printed beside it.
 */
export function UptimeStrip({ points, hours = 24, buckets = 48, showPct = true, now = Date.now(), className = "" }: { points: UptimePoint[]; hours?: number; buckets?: number; showPct?: boolean; now?: number; className?: string }) {
  if (points.length === 0) return <span className="text-xs text-muted">No checks yet</span>;
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
              className="block min-w-px flex-1"
              style={s ? { height: "100%", background: TONE[s], boxShadow: GLOW[s] } : { height: "30%", background: "var(--color-line)" }}
            />
          );
        })}
      </div>
      {showPct && <span className={`w-14 shrink-0 text-right font-mono text-xs tabular-nums ${pct === 100 ? "text-emerald" : "text-ink"}`}>{pct == null ? "—" : pctLabel(pct)}</span>}
    </div>
  );
}
