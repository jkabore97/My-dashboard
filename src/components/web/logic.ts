// Pure helpers behind the Web and Build pages (uptime, expiry timeline,
// security score, commit heatmap, deploy timeline). No I/O, so they're tested
// directly and every number on those pages can be traced back to real data.
import type { Database, HostingProject, Repo, SecurityReport, Severity, Website } from "@/lib/types";
import { certificateSeverity, registrationSeverity } from "@/lib/risk";
import { daysBetween } from "@/lib/dates";
import type { DomainCheck } from "@/lib/server/domains";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// ── Uptime ─────────────────────────────────────────────────────────────────

export type SiteStatus = Website["status"];
export interface CheckPoint { status: SiteStatus; responseMs: number | null; takenAt: string }

const RANK: Record<SiteStatus, number> = { up: 0, unknown: 1, degraded: 2, down: 3 };
export const worse = (a: SiteStatus, b: SiteStatus) => (RANK[b] > RANK[a] ? b : a);

/** Splits [start, end) into `count` equal buckets holding the worst status seen; null where nothing was checked. */
export function bucketStatus(points: CheckPoint[], start: number, end: number, count: number): (SiteStatus | null)[] {
  const out: (SiteStatus | null)[] = Array(count).fill(null);
  for (const p of points) {
    const t = Date.parse(p.takenAt);
    if (!(t >= start && t <= end)) continue;
    const i = Math.min(count - 1, Math.floor(((t - start) / (end - start)) * count));
    out[i] = out[i] ? worse(out[i]!, p.status) : p.status;
  }
  return out;
}

/** Share of checks that came back up, or null with no checks. */
export function uptimePct(points: CheckPoint[]): number | null {
  if (!points.length) return null;
  return (points.filter((p) => p.status === "up").length / points.length) * 100;
}

/** Median response time per bucket (null where no timed check landed). */
export function medianResponse(points: CheckPoint[], start: number, end: number, count: number): (number | null)[] {
  const lists: number[][] = Array.from({ length: count }, () => []);
  for (const p of points) {
    const t = Date.parse(p.takenAt);
    if (p.responseMs == null || !(t >= start && t <= end)) continue;
    lists[Math.min(count - 1, Math.floor(((t - start) / (end - start)) * count))].push(p.responseMs);
  }
  return lists.map((l) => {
    if (!l.length) return null;
    const s = [...l].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
  });
}

export const pctLabel = (p: number) => `${p >= 99.995 ? "100" : p >= 99 ? (Math.floor(p * 100) / 100).toFixed(2) : p.toFixed(1)}%`;

// ── Domains ────────────────────────────────────────────────────────────────

export interface ExpiryRow {
  domain: string;
  /** Fraction of the horizon until expiry (0…1), null when unknown or the lookup failed. */
  ssl: { frac: number; days: number; severity: Severity | null } | null;
  reg: { frac: number; days: number; severity: Severity | null } | null;
}

/** Registration and certificate expiry for each checked domain, as positions on a timeline of `horizonDays`. */
export function expiryRows(checks: DomainCheck[], today: string, horizonDays = 365): ExpiryRow[] {
  const pos = (date: string | null | undefined, sev: (d: number) => Severity | null) => {
    if (!date) return null;
    const days = daysBetween(today, date.slice(0, 10));
    return { frac: Math.max(0, Math.min(1, days / horizonDays)), days, severity: sev(days) };
  };
  return checks.map((c) => ({
    domain: c.domain,
    ssl: c.certificate.ok ? pos(c.certificate.expiresOn, certificateSeverity) : null,
    reg: c.registration.ok ? pos(c.registration.expiresOn, registrationSeverity) : null,
  }));
}

// ── Security score ─────────────────────────────────────────────────────────

/** Points taken off per open finding; shown on the page so the score is never a black box. */
export const PENALTY: Record<Severity, number> = { critical: 25, high: 15, medium: 5, low: 2 };
export const DEPENDABOT_OFF_PENALTY = 3;

export interface ScorePart { key: "code" | "twofa" | "database"; label: string; score: number; detail: string }
export interface SecurityScore { score: number | null; parts: ScorePart[] }

/**
 * 0–100 per area, then the plain average of the areas that have data:
 * code (100 minus penalties for open alerts and repos without Dependabot),
 * two-factor (share of accounts in use that are confirmed), database (100
 * minus penalties for advisor findings). An area with no data is left out.
 */
export function securityScore(input: { security: SecurityReport; codeKnown: boolean; twofa: { confirmed: number; total: number }; databases: Pick<Database, "advisories">[]; databaseKnown: boolean }): SecurityScore {
  const parts: ScorePart[] = [];
  if (input.codeKnown) {
    const off = input.security.repos.filter((r) => r.dependabot === "off").length;
    const lost = input.security.alerts.reduce((n, a) => n + PENALTY[a.severity], 0) + off * DEPENDABOT_OFF_PENALTY;
    parts.push({ key: "code", label: "Code", score: Math.max(0, 100 - lost), detail: `${input.security.alerts.length} open alert${input.security.alerts.length === 1 ? "" : "s"}${off ? `, ${off} repo${off === 1 ? "" : "s"} without Dependabot` : ""}` });
  }
  if (input.twofa.total > 0) {
    parts.push({ key: "twofa", label: "2FA", score: Math.round((input.twofa.confirmed / input.twofa.total) * 100), detail: `${input.twofa.confirmed} of ${input.twofa.total} accounts confirmed` });
  }
  if (input.databaseKnown) {
    const advs = input.databases.flatMap((d) => d.advisories ?? []);
    const lost = advs.reduce((n, a) => n + PENALTY[a.level], 0);
    parts.push({ key: "database", label: "Database", score: Math.max(0, 100 - lost), detail: `${advs.length} advisor finding${advs.length === 1 ? "" : "s"}` });
  }
  if (!parts.length) return { score: null, parts };
  return { score: Math.round(parts.reduce((n, p) => n + p.score, 0) / parts.length), parts };
}

export const scoreWord = (s: number) => (s >= 90 ? "Secure" : s >= 70 ? "Fair" : "At risk");

// ── Repos ──────────────────────────────────────────────────────────────────

/** Repos per primary language, most common first. */
export function languageCounts(repos: Pick<Repo, "language">[]): { language: string; count: number }[] {
  const m = new Map<string, number>();
  for (const r of repos) if (r.language) m.set(r.language, (m.get(r.language) ?? 0) + 1);
  return [...m].map(([language, count]) => ({ language, count })).sort((a, b) => b.count - a.count || a.language.localeCompare(b.language));
}

/** Commits per day summed across repos, aligned by week (oldest first). Null when no repo has activity data. */
export function commitHeatmap(repos: Pick<Repo, "activity">[]): { weeks: { weekStart: string; days: number[] }[]; total: number; repos: number } | null {
  const m = new Map<string, number[]>();
  let n = 0;
  for (const r of repos) {
    if (!r.activity?.length) continue;
    n++;
    for (const w of r.activity) {
      const cur = m.get(w.weekStart) ?? [0, 0, 0, 0, 0, 0, 0];
      w.days.forEach((d, i) => (cur[i] += d));
      m.set(w.weekStart, cur);
    }
  }
  if (!n) return null;
  const weeks = [...m].sort(([a], [b]) => a.localeCompare(b)).map(([weekStart, days]) => ({ weekStart, days }));
  return { weeks, total: weeks.reduce((s, w) => s + w.days.reduce((a, b) => a + b, 0), 0), repos: n };
}

/** Weekly commit totals for the last `weeks` weeks of one repo. */
export const weeklyTotals = (r: Pick<Repo, "activity">, weeks = 12) => (r.activity ?? []).slice(-weeks).map((w) => w.days.reduce((a, b) => a + b, 0));

// ── Hosting ────────────────────────────────────────────────────────────────

export interface DeployMark { project: string; at: string; frac: number; state: HostingProject["lastDeployState"]; provider: HostingProject["provider"] }

/**
 * Production deploys inside [now - hours, now] placed on a 0…1 axis: Vercel's
 * recent deploy list where present, otherwise a Worker's last upload.
 */
export function deployMarks(hosting: HostingProject[], now: number, hours = 24): DeployMark[] {
  const start = now - hours * HOUR;
  const out: DeployMark[] = [];
  const add = (h: HostingProject, at: string | null, state: HostingProject["lastDeployState"]) => {
    const t = at ? Date.parse(at) : NaN;
    if (t >= start && t <= now) out.push({ project: h.name, at: at!, frac: (t - start) / (now - start), state, provider: h.provider });
  };
  for (const h of hosting) {
    if (h.recentDeploys) h.recentDeploys.forEach((d) => add(h, d.at, d.state));
    else if (h.provider !== "vercel") add(h, h.lastDeployAt, h.lastDeployState);
  }
  return out.sort((a, b) => a.frac - b.frac);
}

/** Whether Vercel deploy history was available for any project. */
export const hasDeployHistory = (hosting: HostingProject[]) => hosting.some((h) => h.recentDeploys !== undefined);

export function averageBuildMs(hosting: HostingProject[]): number | null {
  const b = hosting.flatMap((h) => (h.recentDeploys ?? []).map((d) => d.buildMs)).filter((x): x is number => x != null);
  return b.length ? Math.round(b.reduce((s, x) => s + x, 0) / b.length) : null;
}

// ── Databases ──────────────────────────────────────────────────────────────

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export const DAY_MS = DAY;
