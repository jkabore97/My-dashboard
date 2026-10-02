import type { UptimeSummary } from "@/lib/portal";

// Pure: the headline of a client's status page, from their sites only.

export interface Overall {
  state: "up" | "degraded" | "down" | "unknown";
  title: string;
  detail: string;
  /** Mean 30-day uptime across sites that have one. */
  uptime30d: number | null;
}

export function overallStatus(sites: Pick<UptimeSummary, "status" | "uptime30d">[]): Overall {
  const n = (s: UptimeSummary["status"]) => sites.filter((x) => x.status === s).length;
  const [up, down, degraded, unknown] = [n("up"), n("down"), n("degraded"), n("unknown")];
  const known = sites.filter((s) => s.uptime30d !== null).map((s) => s.uptime30d!);
  const uptime30d = known.length ? Math.round((known.reduce((a, b) => a + b, 0) / known.length) * 100) / 100 : null;
  const plural = (k: number, w: string) => `${k} ${w}${k === 1 ? "" : "s"}`;
  if (down) return { state: "down", title: down === sites.length ? "Your websites are down" : `${plural(down, "website")} down`, detail: `${up} up · ${down} down${degraded ? ` · ${degraded} slow` : ""}`, uptime30d };
  if (degraded) return { state: "degraded", title: `${plural(degraded, "website")} slow or partly down`, detail: `${up} up · ${degraded} slow`, uptime30d };
  if (up === 0) return { state: "unknown", title: "Not checked yet", detail: "The first checks run within a few minutes.", uptime30d };
  return { state: "up", title: "All systems operational", detail: `${plural(up, "website")} up${unknown ? ` · ${unknown} not checked yet` : ""}`, uptime30d };
}
