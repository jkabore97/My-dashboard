import { cache } from "react";
import { after } from "next/server";
import { getCloudflareD1, getCloudflareWorkers } from "./connectors/cloudflare";
import { getEmails } from "./connectors/gmail";
import { getGithubNotifications, getRepos } from "./connectors/github";
import { getSupabaseProjects } from "./connectors/supabase";
import { getVercelProjects } from "./connectors/vercel";
import { getWebsites } from "./connectors/websites";
import { getDomains, getRecords } from "./connectors/records";
import { getSecurity } from "./connectors/security";
import { getStripe } from "./connectors/stripe";
import { today } from "./dates";
import { deriveRiskTasks, type RiskScope } from "./risk";
import { deriveGrowthTasks, type GrowthScope } from "./growth";
import { deriveDeviceTasks, type DeviceScope } from "./devices";
import { getCameras } from "./connectors/hikvision";
import { getSolar } from "./connectors/solar";
import { businessTimeZone } from "./dates";
import { getAnalytics, lastDays } from "./connectors/analytics";
import { getCalendar } from "./connectors/calendar";
import { getOutlook } from "./connectors/outlook";
import { getPersonal, type PersonalProblem } from "./connectors/personal";
import { getReviews } from "./connectors/reviews";
import { businessForDomain } from "./server/config";
import { getPlatforms } from "./platforms";
import { withTriage } from "./server/triage";
import { getConfig } from "./server/config";
import { connectionHealth } from "./server/credentials";
import { claimInterval, deleteSetting, getSetting, setSetting } from "./server/store/settings";
import { decryptJson, encryptJson } from "./server/crypto";
import type { CalendarEvent, Database, EmailMessage, HostingProject, Notification, Repo, SourceMode, SourceResult, Task, Website } from "./types";

const DAY = 86_400_000;

export type Scope = "connector" | "github" | "vercel" | "workers" | "supabase" | "d1" | "gmail" | "outlook" | "mymail" | "websites" | RiskScope | GrowthScope | DeviceScope;

/**
 * A task generated from platform data. `scope` is the source it came from;
 * `live` is false when that source served demo or fallback data.
 */
export type DerivedTask = Task & { live: boolean; scope: Scope; alias?: string };

type Config = Awaited<ReturnType<typeof getConfig>>;

/** Everything that comes from other platforms (APIs, uptime probes, recorders). */
async function fetchExternal({ businessRules, sites }: Config) {
  const [repos, ghNotes, vercel, workers, supabase, d1, gmail, stripe, outlook, calendar, analytics, reviews, cameras, personal] = await Promise.all([
    getRepos(businessRules),
    getGithubNotifications(),
    getVercelProjects(businessRules),
    getCloudflareWorkers(businessRules),
    getSupabaseProjects(businessRules),
    getCloudflareD1(businessRules),
    getEmails(),
    getStripe(),
    getOutlook(),
    getCalendar(),
    getAnalytics(sites.map((x) => x.domain)),
    getReviews(),
    getCameras(),
    // People's own mailboxes and calendars: cached here with the rest (encrypted),
    // every item tagged with its owner; scope.ts gives each to its owner alone.
    getPersonal(),
  ]);
  const hosting = mergeSources([vercel, workers]).data;
  const [security, websiteResult] = await Promise.all([getSecurity(repos.data, repos.mode === "live"), getWebsites(sites, hosting)]);
  return { repos, ghNotes, vercel, workers, supabase, d1, gmail, stripe, outlook, calendar, analytics, reviews, cameras, security, websiteResult, personal };
}

// Other platforms are slow (uptime probes wait up to 5 s, mail and calendars
// take a second or more), so their results are kept in the database, shared by
// every server instance and surviving cold starts, plus a copy in memory. A
// page always renders from the last saved results at once; when they're over
// a minute old, one instance refetches in the background and the page refreshes
// itself when that lands. Only the very first load (or one right after a
// connection or the business/site setup changed) waits for the platforms.
type External = Awaited<ReturnType<typeof fetchExternal>>;
const EXTERNAL_FRESH_MS = 60_000;
const SNAPSHOT_KEY = "cache:external";
let external: { key: string; at: number; value: Promise<External> } | null = null;

let forceRefetch = false;

/**
 * This instance's next collect() fetches every platform afresh and overwrites
 * the saved copy, which other instances keep serving meanwhile (cron).
 */
export function refetchExternal() {
  forceRefetch = true;
}

/** Drops the saved copy so the next request anywhere refetches (after connecting or disconnecting a platform). */
export async function invalidateExternal() {
  external = null;
  await deleteSetting(SNAPSHOT_KEY).catch(() => {});
}

/** Tests: drop this instance's copy, as a fresh server instance would start. */
export function forgetExternalMemory() {
  external = null;
}

async function readSnapshot(key: string): Promise<{ at: number; value: External } | null> {
  try {
    const snap = await getSetting<{ key: string; at: number; data: string } | null>(SNAPSHOT_KEY, null);
    if (!snap || snap.key !== key) return null;
    return { at: snap.at, value: decryptJson<External>(snap.data) };
  } catch {
    return null; // unreadable (database down, key rotated): fetch live instead
  }
}

async function fetchAndSave(config: Config, key: string): Promise<External> {
  const value = await fetchExternal(config);
  const at = Date.now();
  external = { key, at, value: Promise.resolve(value) };
  // Mail subjects and the like are stored encrypted, like credentials.
  await setSetting(SNAPSHOT_KEY, { key, at, data: encryptJson(value) }).catch((err) => console.error(`[cache] ${err instanceof Error ? err.message : err}`));
  return value;
}

function refreshInBackground(config: Config, key: string) {
  const refresh = async () => {
    // One instance refreshes at a time; the others keep serving the snapshot.
    if (!(await claimInterval("job:external", 45).catch(() => true))) return;
    await fetchAndSave(config, key).catch((err) => console.error(`[cache] ${err instanceof Error ? err.message : err}`));
  };
  try {
    after(refresh);
  } catch {
    void refresh();
  }
}

async function externalData(config: Config): Promise<{ at: number; value: External }> {
  const key = JSON.stringify([config.businessRules, config.sites]);
  if (forceRefetch) {
    forceRefetch = false;
    const value = await fetchAndSave(config, key);
    return { at: external?.at ?? Date.now(), value };
  }
  if (external?.key === key && Date.now() - external.at <= EXTERNAL_FRESH_MS) return { at: external.at, value: await external.value };
  const snap = await readSnapshot(key);
  if (!snap) {
    const value = fetchAndSave(config, key);
    external = { key, at: Date.now(), value };
    value.catch(() => {
      if (external?.value === value) external = null;
    });
    return { at: Date.now(), value: await value };
  }
  external = { key, at: snap.at, value: Promise.resolve(snap.value) };
  if (Date.now() - snap.at > EXTERNAL_FRESH_MS) refreshInBackground(config, key);
  return snap;
}

/** Fetches every source once per request. Pure reads: no database writes. */
export const collect = cache(async () => {
  const config = await getConfig();
  const { sites, domains: watchedDomains } = config;
  // Your own records come straight from the database, so edits show at once.
  const [{ at: externalAt, value: ext }, records, domains, solarAll] = await Promise.all([externalData(config), getRecords(), getDomains(watchedDomains), getSolar()]);
  const { repos, ghNotes, vercel, workers, supabase, d1, gmail, stripe, outlook, calendar: sharedCalendar, analytics, reviews, cameras, security, websiteResult } = ext;
  // A snapshot saved before personal mailboxes existed has none.
  const personal = ext.personal ?? { source: "My mail", mode: "demo" as SourceMode, data: { emails: [], calendar: [], problems: [] }, fetchedAt: new Date().toISOString() };
  const solar = solarAll.result;
  // Gmail, Outlook and people's own mailboxes share one inbox; each message
  // keeps its mailbox id, and personal ones their owner.
  const merged = mergeSources<EmailMessage>([gmail, outlook, { mode: personal.mode, data: personal.data.emails }]);
  const calendar = { ...sharedCalendar, ...mergeSources<CalendarEvent>([sharedCalendar, { mode: personal.mode, data: personal.data.calendar }]) };
  if (calendar.mode === "live") calendar.data.sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || a.title.localeCompare(b.title));
  // Claude's triage (when enabled) replaces the keyword severity for messages it has read.
  const emails = { ...merged, data: merged.mode === "live" ? await withTriage(merged.data) : merged.data };
  emails.data.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  const hosting = mergeSources([vercel, workers]).data;
  // Visitors (7 days) come from Google Analytics when a property matched the site.
  const websites = {
    ...websiteResult,
    data: websiteResult.data.map((w) => {
      const t = analytics.mode === "live" ? analytics.data.find((a) => a.domain === w.domain)?.traffic : null;
      return t ? { ...w, visitors7d: lastDays(t.users, 7) } : w;
    }),
  };
  const databases = mergeSources([supabase, d1]).data;
  // When stored connections couldn't be read, "demo" may mean "credentials
  // unknown" rather than "not connected", so it can't be used to close tasks.
  const { readable: credentialsKnown, undecryptable } = await connectionHealth();
  const guards = undecryptableGuards(undecryptable);

  // Shared sources only: a personal mailbox's trouble goes to its owner (personalProblems), never into these.
  const sources: SourceResult<unknown>[] = [repos, vercel, workers, supabase, d1, gmail, outlook, websites, stripe, domains, security, records, sharedCalendar, analytics, reviews, cameras, solar];
  const modes = {
    github: repos.mode,
    githubNotes: ghNotes.mode,
    vercel: vercel.mode,
    workers: workers.mode,
    supabase: supabase.mode,
    d1: d1.mode,
    gmail: gmail.mode,
    outlook: outlook.mode,
    inbox: emails.mode,
    calendar: calendar.mode,
    mymail: personal.mode,
    analytics: analytics.mode,
    reviews: reviews.mode,
    pipeline: records.mode,
    websites: websites.mode,
    stripe: stripe.mode,
    invoices: records.mode,
    subscriptions: records.mode,
    deadlines: records.mode,
    checklist: records.mode,
    domains: domains.mode,
    security: security.mode,
    cameras: cameras.mode,
    solar: solar.mode,
  };

  const risk = deriveRiskTasks({
    today: today(),
    stripe: stripe.data,
    records: records.data,
    domains: domains.data,
    security: security.data,
    sites,
    repos: repos.data.map((r) => r.fullName),
    modes,
    partial: { stripe: (stripe.partial ?? []).map((p) => p.key), security: (security.partial ?? []).map((p) => p.key) },
    credentialsKnown,
  });

  const growth = deriveGrowthTasks({
    today: today(),
    deals: records.data.deals,
    reviews: reviews.data,
    analytics: analytics.data,
    domains: sites.map((x) => x.domain),
    businessForDomain: (d) => businessForDomain(d, sites),
    modes,
    partial: { reviews: (reviews.partial ?? []).map((p) => p.key) },
  });

  const devices = deriveDeviceTasks({
    cameras: cameras.data,
    solar: solar.data,
    solarSettings: solarAll.config,
    timeZone: businessTimeZone(),
    modes,
    partial: { cameras: (cameras.partial ?? []).map((p) => p.key) },
  });

  const tasks: DerivedTask[] = [...deriveTasks({ repos: repos.data, hosting, databases, emails: emails.data, websites: websites.data, sources, modes, personalProblems: personal.data.problems }), ...risk.tasks, ...growth.tasks, ...devices.tasks];

  const live = (m: SourceMode) => m === "live";
  const notifications: (Notification & { live: boolean })[] = [
    ...emails.data.map((e) => ({ id: `mail:${e.id}`, source: `${e.mailbox.startsWith("ms:") ? "Outlook" : "Email"} · ${e.account}`, title: e.subject, body: e.from, at: e.receivedAt, severity: e.severity, url: e.url, business: e.business, ...(e.owner ? { owner: e.owner } : {}), live: live(emails.mode) })),
    ...reviews.data.flatMap((p) =>
      p.reviews.map((r) => ({ id: `review:${r.id}`, source: `Google reviews · ${p.name}`, title: `New ${r.rating}★ review from ${r.author}`, body: r.text.slice(0, 160), at: r.publishedAt, severity: r.rating <= 3 ? ("high" as const) : ("low" as const), url: p.url ?? undefined, business: p.business, live: live(reviews.mode) })),
    ),
    ...ghNotes.data.map((n) => ({ ...n, live: live(ghNotes.mode) })),
    ...hosting
      .filter((h) => h.lastDeployAt && h.lastDeployState)
      .map((h) => ({
        id: `deploy:${h.id}:${h.lastDeployAt}:${h.lastDeployState}`,
        source: h.provider === "vercel" ? "Vercel" : "Cloudflare",
        title: `${h.name}: deploy ${h.lastDeployState}`,
        at: h.lastDeployAt!,
        severity: h.lastDeployState === "error" ? ("critical" as const) : ("low" as const),
        url: h.url ?? undefined,
        business: h.business,
        live: live(h.provider === "vercel" ? vercel.mode : workers.mode),
      })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return {
    externalAt,
    repos: repos.data,
    hosting,
    databases,
    emails: emails.data,
    websites: websites.data,
    stripe: stripe.data,
    records: records.data,
    domains: domains.data,
    security: security.data,
    calendar: calendar.data,
    analytics: analytics.data,
    reviews: reviews.data,
    cameras: cameras.data,
    solar: solar.data,
    solarConfig: solarAll.config,
    derivedTasks: tasks,
    notifications,
    modes,
    platforms: getPlatforms({
      github: repos.mode,
      vercel: vercel.mode,
      cloudflare: workers.mode === "error" || d1.mode === "error" ? "error" : workers.mode,
      supabase: supabase.mode,
      gmail: gmail.mode,
      websites: websites.mode,
      stripe: stripe.mode,
      microsoft: outlook.mode,
      reviews: reviews.mode,
      hikvision: cameras.mode,
      solar: solar.mode,
    }),
    sources: sources.map(({ source, mode, error, partial, fetchedAt }) => ({ source, mode, error, partial, fetchedAt })),
    unobserved: [...unobservedKeys({ gmail: gmail.partial, supabase: supabase.partial, github: repos.partial, mymail: personal.partial }), ...guards.unobserved, ...risk.unobserved, ...growth.unobserved, ...devices.unobserved, ...(outlook.partial ?? []).map((p) => `outlook/${encodeURIComponent(p.key)}/`)],
    /** Personal accounts that couldn't be read; each is shown to its owner only. */
    personalProblems: personal.data.problems,
    skipScopes: guards.skipScopes,
    credentialsKnown,
    undecryptableConnections: undecryptable.length,
    // Records are your own entries (always "live"), so they don't count here.
    allDemo: sources.every((s) => s === records || s.mode === "demo"),
  };
});

export type Collected = Awaited<ReturnType<typeof collect>>;

/**
 * Merges sources that feed one list (Gmail + Outlook, Vercel + Workers…).
 * Demo data never mixes with real data: once any source is live, only live
 * sources contribute. The combined mode is live if any source is, error if
 * one failed and none is live, and demo only when all are.
 */
export function mergeSources<T>(results: Pick<SourceResult<T[]>, "mode" | "data">[]): { mode: SourceMode; data: T[] } {
  const live = results.filter((r) => r.mode === "live");
  const mode: SourceMode = live.length ? "live" : results.some((r) => r.mode === "error") ? "error" : "demo";
  return { mode, data: (live.length ? live : results).flatMap((r) => r.data) };
}

interface DeriveInput {
  repos: Repo[];
  hosting: HostingProject[];
  databases: Database[];
  emails: EmailMessage[];
  websites: Website[];
  sources: Pick<SourceResult<unknown>, "source" | "mode" | "error" | "partial">[];
  modes: Record<"github" | "vercel" | "workers" | "supabase" | "d1" | "gmail" | "websites", SourceMode> & { outlook?: SourceMode; mymail?: SourceMode };
  /** People's own accounts that couldn't be read: a private "reconnect" task for each owner. */
  personalProblems?: PersonalProblem[];
}

/**
 * Turns raw signals from every platform into one prioritized to-do list.
 * Each task id is a stable key: the same problem always produces the same id,
 * which is how the database tracks done/snoozed state across refreshes.
 */
export function deriveTasks(s: DeriveInput): DerivedTask[] {
  const now = new Date().toISOString();
  const tasks: DerivedTask[] = [];
  const add = (scope: Scope, key: string, t: Omit<Task, "id">) =>
    tasks.push({ ...t, id: `${scope}/${key}`, scope, live: scope === "connector" || (s.modes as Record<string, SourceMode>)[scope] === "live" });

  // Several sources can share a platform name (Cloudflare Workers + D1), so
  // problems are merged into one task per platform.
  const problems = new Map<string, string[]>();
  for (const src of s.sources) {
    const errors = src.mode === "error" ? [src.error ?? "unknown error"] : (src.partial ?? []).map((p) => p.error);
    if (errors.length) problems.set(src.source, [...(problems.get(src.source) ?? []), ...errors]);
  }
  for (const [source, errors] of problems) {
    add("connector", source, { title: `Fix the ${source} connection`, detail: [...new Set(errors)].join(" · "), severity: "high", source: "Dashboard", url: "/platforms", createdAt: now });
  }

  for (const w of s.websites) {
    if (w.status === "down") add("websites", `down:${w.domain}`, { title: `${w.domain} is down`, detail: "Site did not respond within 8s or returned a 5xx", severity: "critical", source: "Website monitor", url: `https://${w.domain}`, createdAt: now, business: w.business });
    else if (w.status === "degraded") add("websites", `slow:${w.domain}`, { title: `${w.domain} is slow or erroring`, detail: w.responseMs ? `${w.responseMs} ms response` : undefined, severity: "high", source: "Website monitor", url: `https://${w.domain}`, createdAt: now, business: w.business });
  }

  for (const h of s.hosting) {
    if (h.lastDeployState === "error") {
      const vercel = h.provider === "vercel";
      add(vercel ? "vercel" : "workers", `deploy-failed:${h.id}`, { title: `Production deploy failed: ${h.name}`, severity: "critical", source: vercel ? "Vercel" : "Cloudflare", url: vercel ? "https://vercel.com/dashboard" : undefined, createdAt: h.lastDeployAt ?? now, business: h.business });
    }
  }

  for (const d of s.databases) {
    const scope = d.provider === "supabase" ? "supabase" : "d1";
    for (const a of d.advisories ?? []) {
      if (a.level === "low") continue;
      add(scope, `advisor:${d.id}:${a.title.slice(0, 120)}`, { title: `${d.name}: ${a.title}`, severity: a.level, source: "Supabase advisor", url: d.provider === "supabase" ? `https://supabase.com/dashboard/project/${d.id}/advisors/security` : undefined, createdAt: now, business: d.business });
    }
    if (d.status === "paused") add(scope, `paused:${d.id}`, { title: `${d.name} is paused — restore or delete it`, severity: "low", source: "Supabase", createdAt: d.createdAt ?? now, business: d.business });
    if (d.status === "degraded") add(scope, `unhealthy:${d.id}`, { title: `${d.name} database is unhealthy`, severity: "critical", source: "Supabase", createdAt: now, business: d.business });
  }

  for (const e of s.emails) {
    if (!e.unread || e.severity === "low") continue;
    if (e.owner) {
      // Someone's own mailbox: a personal task, theirs alone (no business).
      add("mymail", `${encodeURIComponent(e.mailbox)}/${e.id}`, { title: e.subject, detail: `From ${e.from}`, severity: e.severity, source: "Email · my mailbox", url: e.url, createdAt: e.receivedAt, privateTo: e.owner });
    } else {
      add(e.mailbox.startsWith("ms:") ? "outlook" : "gmail", `${encodeURIComponent(e.mailbox)}/${e.id}`, { title: e.subject, detail: `From ${e.from}`, severity: e.severity, source: `Email · ${e.account}`, url: e.url, createdAt: e.receivedAt, business: e.account });
    }
  }
  for (const p of s.personalProblems ?? []) {
    add("mymail", `${encodeURIComponent(p.mailbox)}/reconnect`, { title: `Reconnect your ${p.provider === "microsoft" ? "Microsoft" : "Google"} mailbox (${p.account})`, detail: p.error, severity: "high", source: "My mail & calendar", url: "/settings#my-mail", createdAt: now, privateTo: p.owner });
  }

  for (const r of s.repos) {
    if (r.openPullRequests == null || r.openIssues == null) continue; // counts unknown this round
    if (r.openPullRequests > 0) add("github", `prs:${r.fullName}`, { title: `Review ${r.openPullRequests} open PR${r.openPullRequests > 1 ? "s" : ""} in ${r.name}`, severity: "medium", source: "GitHub", url: `${r.url}/pulls`, createdAt: r.pushedAt, business: r.business });
    if (r.openIssues >= 10) add("github", `issues:${r.fullName}`, { title: `Triage ${r.openIssues} open issues in ${r.name}`, severity: "medium", source: "GitHub", url: `${r.url}/issues`, createdAt: r.pushedAt, business: r.business });
    if (Date.now() - Date.parse(r.pushedAt) > 30 * DAY && r.openIssues + r.openPullRequests > 0) {
      add("github", `stale:${r.fullName}`, { title: `${r.name} has open work but no pushes in 30+ days`, severity: "low", source: "GitHub", url: r.url, createdAt: r.pushedAt, business: r.business });
    }
  }

  return tasks;
}

/**
 * Task-key prefixes (within otherwise live scopes) whose condition couldn't be
 * checked this round because part of a source failed. Reconciliation leaves
 * them alone. Keys must match the formats used in deriveTasks. A prefix may
 * also cover a sibling (e.g. repo "a/site" covers "a/site-2"), which only
 * delays that sibling's auto-resolve by a round.
 */
export function unobservedKeys(p: { gmail?: { key: string }[]; supabase?: { key: string }[]; github?: { key: string }[]; mymail?: { key: string }[] }): string[] {
  return [
    ...(p.gmail ?? []).map(({ key }) => `gmail/${encodeURIComponent(key)}/`),
    ...(p.mymail ?? []).map(({ key }) => `mymail/${encodeURIComponent(key)}/`),
    ...(p.supabase ?? []).map(({ key }) => `supabase/advisor:${key}:`),
    ...(p.github ?? []).flatMap(({ key }) => ["prs", "issues", "stale"].map((k) => `github/${k}:${key}`)),
  ];
}

const PROVIDER_SCOPES: Record<string, Scope[]> = { github: ["github"], vercel: ["vercel"], supabase: ["supabase"], cloudflare: ["workers", "d1"], hikvision: ["cameras"] };

/**
 * A stored connection that no longer decrypts is an account we can't see, even
 * if an env fallback (or another mailbox) keeps the source live: its tasks
 * must not auto-close. Gmail is protected per mailbox (keyed by address, as in
 * deriveTasks); single-account providers lose reconciliation entirely.
 */
export function undecryptableGuards(rows: { provider: string; account: string; ownerEmail?: string | null }[]): { unobserved: string[]; skipScopes: string[] } {
  return {
    unobserved: rows.flatMap((r) =>
      // Someone's own mailbox: its personal tasks stay as they are.
      r.ownerEmail ? [`mymail/${encodeURIComponent(r.provider === "microsoft" ? `ms:${r.account}` : r.account)}/`]
      : r.provider === "gmail" ? [`gmail/${encodeURIComponent(r.account)}/`]
      : r.provider === "stripe" ? [`stripe/${encodeURIComponent(r.account)}/`]
      : r.provider === "microsoft" ? [`outlook/${encodeURIComponent(`ms:${r.account}`)}/`]
      : [],
    ),
    skipScopes: [...new Set(rows.flatMap((r) => (r.ownerEmail ? [] : (PROVIDER_SCOPES[r.provider] ?? []))))],
  };
}
