import { createHash } from "node:crypto";
import { daysBetween, formatDate, relativeDays } from "./dates";
import { formatMoney } from "./money";
import type { Deal } from "./server/store/pipeline";
import type { PlaceReviews, Severity, SiteAnalytics, SourceMode, Task } from "./types";

// Phase 3 rules: client follow-ups, reviews and traffic → tasks. Pure, like
// risk.ts; collect() feeds it and persist() stores the result.

export type GrowthScope = "pipeline" | "reviews" | "analytics";

export interface GrowthTask extends Task {
  scope: GrowthScope;
  live: boolean;
}

export interface GrowthInput {
  today: string;
  deals: Deal[];
  reviews: PlaceReviews[];
  analytics: SiteAnalytics[];
  /** Domains being watched; ones without analytics data this round are left alone. */
  domains: string[];
  businessForDomain: (domain: string) => string | undefined;
  modes: Record<GrowthScope, SourceMode>;
  /** Partial failures: review place ids. */
  partial: { reviews: string[] };
}

export const STALL_DAYS = 14;
export const LOW_REVIEW_MAX_STARS = 3;
export const REVIEW_WINDOW_DAYS = 30;
/** A week-on-week drop this large, from at least this many sessions, raises a task. */
export const TRAFFIC_DROP = 0.4;
export const TRAFFIC_MIN_SESSIONS = 50;

export function followUpSeverity(daysOverdue: number): Severity {
  return daysOverdue > 3 ? "high" : "medium";
}

/** Week-on-week change in sessions, or null when there isn't enough data. */
export function weeklyChange(points: { value: number }[]): { thisWeek: number; lastWeek: number; change: number } | null {
  if (points.length < 14) return null;
  const thisWeek = points.slice(-7).reduce((n, p) => n + p.value, 0);
  const lastWeek = points.slice(-14, -7).reduce((n, p) => n + p.value, 0);
  if (lastWeek === 0) return null;
  return { thisWeek, lastWeek, change: (thisWeek - lastWeek) / lastWeek };
}

const short = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 12);
const stars = (n: number) => `${n}★`;

export function deriveGrowthTasks(g: GrowthInput): { tasks: GrowthTask[]; unobserved: string[] } {
  const tasks: GrowthTask[] = [];
  const unobserved: string[] = [];
  const now = new Date().toISOString();
  const add = (scope: GrowthScope, key: string, t: Omit<Task, "id">) => tasks.push({ ...t, id: `${scope}/${key}`, scope, live: g.modes[scope] === "live" });

  // ─── Pipeline ───
  for (const d of g.deals) {
    if (d.stage === "won" || d.stage === "lost") continue;
    const who = d.clientName ?? d.title;
    const value = d.valueMinor != null ? ` · ${formatMoney(d.valueMinor, d.currency)}` : "";
    if (d.nextStep && d.nextStepDue && d.nextStepDue <= g.today) {
      const late = daysBetween(d.nextStepDue, g.today);
      add("pipeline", `${d.id}:next:${d.nextStepDue}`, {
        title: `${who}: ${d.nextStep}`,
        detail: `${d.title} (${d.stage})${value} · ${late === 0 ? "due today" : `${late} day${late === 1 ? "" : "s"} overdue`}`,
        severity: late === 0 ? "medium" : followUpSeverity(late),
        source: "Pipeline",
        url: "/clients",
        createdAt: `${d.nextStepDue}T00:00:00.000Z`,
        business: d.business ?? undefined,
      });
    }
    if (d.expectedClose && d.expectedClose < g.today) {
      add("pipeline", `${d.id}:close:${d.expectedClose}`, {
        title: `Update "${d.title}": expected to close ${formatDate(d.expectedClose)}`,
        detail: `Still in ${d.stage}${value}. Move it forward, mark it won or lost, or set a new date.`,
        severity: "medium",
        source: "Pipeline",
        url: "/clients",
        createdAt: `${d.expectedClose}T00:00:00.000Z`,
        business: d.business ?? undefined,
      });
    }
    if (!d.nextStep && (d.stage === "proposal" || d.stage === "negotiation") && daysBetween(d.updatedOn, g.today) >= STALL_DAYS) {
      add("pipeline", `${d.id}:stalled`, {
        title: `"${d.title}" has no next step`,
        detail: `In ${d.stage} with no change for ${daysBetween(d.updatedOn, g.today)} days${value}. Decide the next move or close it.`,
        severity: "low",
        source: "Pipeline",
        url: "/clients",
        createdAt: now,
        business: d.business ?? undefined,
      });
    }
  }

  // ─── Reviews ───
  for (const p of g.reviews) {
    for (const r of p.reviews) {
      if (r.rating > LOW_REVIEW_MAX_STARS) continue;
      const age = daysBetween(r.publishedAt.slice(0, 10), g.today);
      if (age > REVIEW_WINDOW_DAYS) continue;
      add("reviews", `${p.placeId}/${short(r.id)}`, {
        title: `Reply to ${stars(r.rating)} review of ${p.name}`,
        detail: `${r.author}, ${relativeDays(-age)}: "${r.text.slice(0, 140)}${r.text.length > 140 ? "…" : ""}"`,
        severity: "high",
        source: "Google reviews",
        url: p.url ?? undefined,
        createdAt: r.publishedAt,
        business: p.business,
      });
    }
  }
  for (const id of g.partial.reviews) unobserved.push(`reviews/${id}/`);

  // ─── Traffic ───
  const seen = new Set<string>();
  for (const a of g.analytics) {
    if (!a.traffic) continue;
    seen.add(a.domain);
    const w = weeklyChange(a.traffic.sessions);
    if (w && w.lastWeek >= TRAFFIC_MIN_SESSIONS && w.change <= -TRAFFIC_DROP) {
      add("analytics", `drop:${a.domain}`, {
        title: `Traffic to ${a.domain} is down ${Math.round(-w.change * 100)}% this week`,
        detail: `${w.thisWeek.toLocaleString()} sessions vs ${w.lastWeek.toLocaleString()} the week before. Check for a broken page, a lost ranking or a tracking change.`,
        severity: "medium",
        source: "Analytics",
        url: "/analytics",
        createdAt: now,
        business: g.businessForDomain(a.domain),
      });
    }
  }
  // No data for a site this round (property not matched, or its account failed): leave its task.
  for (const d of g.domains) if (!seen.has(d)) unobserved.push(`analytics/drop:${d}`);

  return { tasks, unobserved };
}
