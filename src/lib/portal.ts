import type { DealStage } from "./server/store/pipeline";

// Pure pieces of the client status page.

/** Plain-language stage names for clients (no internal sales jargon). Lost deals aren't shown. */
export const CLIENT_STAGE: Record<Exclude<DealStage, "lost">, string> = {
  lead: "In discussion",
  proposal: "Proposal sent",
  negotiation: "Finalizing",
  won: "Underway",
};

export interface UptimeSummary {
  status: "up" | "down" | "degraded" | "unknown";
  checkedAt: string | null;
  responseMs: number | null;
  uptime7d: number | null;
  uptime30d: number | null;
  /** Last 24 hours in hourly buckets, oldest first: share of checks that were up, or null without checks. */
  hours: (number | null)[];
}

/** Pure: website health snapshots (oldest first) → what the client sees. "unknown" checks don't count. */
export function summarizeUptime(checks: { status: string; responseMs: number | null; at: string }[], now = new Date()): UptimeSummary {
  const known = checks.filter((c) => c.status !== "unknown");
  const since = (days: number) => known.filter((c) => Date.parse(c.at) > now.getTime() - days * 86_400_000);
  const pct = (list: typeof known) => (list.length ? Math.round((list.filter((c) => c.status === "up").length / list.length) * 1000) / 10 : null);
  const hours: (number | null)[] = Array.from({ length: 24 }, (_, i) => {
    const from = now.getTime() - (24 - i) * 3_600_000;
    const inHour = known.filter((c) => { const t = Date.parse(c.at); return t > from && t <= from + 3_600_000; });
    return inHour.length ? inHour.filter((c) => c.status === "up").length / inHour.length : null;
  });
  const last = checks[checks.length - 1];
  return {
    status: (last?.status as UptimeSummary["status"]) ?? "unknown",
    checkedAt: last?.at ?? null,
    responseMs: last?.responseMs ?? null,
    uptime7d: pct(since(7)),
    uptime30d: pct(since(30)),
    hours,
  };
}
