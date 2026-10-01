import type { Website } from "@/lib/types";

export interface UptimePoint {
  status: Website["status"];
  responseMs: number | null;
  takenAt: string;
}

const TONE: Record<Website["status"], string> = { up: "bg-ok", degraded: "bg-high", down: "bg-critical", unknown: "bg-low" };
const BUCKETS = 48; // 24h in 30-minute buckets

/**
 * 24 hours of checks as 48 half-hour ticks; each tick shows the worst status
 * seen in that window. Status is never color-alone: every tick has a tooltip
 * and the uptime percentage is printed beside the strip.
 */
export function UptimeStrip({ points }: { points: UptimePoint[] }) {
  if (points.length === 0) return <span className="text-xs text-muted">No checks yet</span>;
  const end = Date.now();
  const start = end - 24 * 3_600_000;
  const rank = { up: 0, unknown: 1, degraded: 2, down: 3 } as const;
  const buckets: (UptimePoint | null)[] = Array(BUCKETS).fill(null);
  for (const p of points) {
    const t = Date.parse(p.takenAt);
    if (t < start) continue;
    const i = Math.min(BUCKETS - 1, Math.floor(((t - start) / (end - start)) * BUCKETS));
    const cur = buckets[i];
    if (!cur || rank[p.status] > rank[cur.status]) buckets[i] = p;
  }
  const up = points.filter((p) => p.status === "up").length;
  const pct = (up / points.length) * 100;
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-5 items-end gap-[2px]" role="img" aria-label={`Uptime ${pct.toFixed(1)}% over 24 hours`}>
        {buckets.map((b, i) => {
          const from = new Date(start + (i * (end - start)) / BUCKETS);
          const label = b
            ? `${from.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}: ${b.status}${b.responseMs != null ? `, ${b.responseMs} ms` : ""}`
            : `${from.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}: no check`;
          return (
            <span key={i} title={label} className="group relative flex h-full w-[5px] items-end py-0">
              <span className={`block w-full rounded-[2px] ${b ? `${TONE[b.status]} h-full` : "h-1/3 bg-line"}`} />
            </span>
          );
        })}
      </div>
      <span className="text-xs tabular-nums text-muted">{pct.toFixed(pct === 100 ? 0 : 1)}%</span>
    </div>
  );
}
