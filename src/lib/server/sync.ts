import { collect, type Collected } from "../aggregate";
import type { Website } from "../types";
import { recordEvent } from "./store/events";
import { pruneOldData } from "./store/maintenance";
import { claimInterval, expireInterval, setSetting } from "./store/settings";
import { latestSnapshot, recordSnapshot, replaceSnapshot } from "./store/snapshots";
import { existingEventKeys, reconcileDerived } from "./store/tasks";
import { getConfig } from "./config";
import { refreshDomainChecks } from "./domains";
import { pushNewCriticalTasks } from "./notify";
import { sendScheduledReports } from "./reports";
import { triagePending } from "./triage";
import { errorMessage } from "../source";

const PAGE_SYNC_SECONDS = 60;

/**
 * Call after changing something tasks are derived from (invoices, deadlines,
 * settings…) so the next page view re-syncs instead of waiting out the
 * throttle. lastRun("job:sync") then reads as never until it runs.
 */
export const requestSync = () => expireInterval("job:sync");

/**
 * Persists what the latest collection saw: derived tasks, new events and
 * website health snapshots. Throttled so concurrent page loads don't repeat
 * the work; cron passes force.
 */
export async function persist(c: Collected, { force = false } = {}) {
  if (!(await claimInterval("job:sync", force ? 0 : PAGE_SYNC_SECONDS))) return false;

  // Only live data is persisted; demo/errored sources would pollute history.
  // A source that is failing (wholly, or the parts in c.unobserved) never
  // auto-resolves the tasks it couldn't see. A source that isn't configured
  // (demo) has no conditions left, so its tasks close: that's a disconnect.
  // skipScopes: providers with a stored connection that no longer decrypts.
  const scopes = (Object.entries(c.modes) as [string, string][])
    .filter(([k, m]) => (m === "live" || (m === "demo" && c.credentialsKnown)) && !c.skipScopes.includes(k))
    .map(([k]) => k);
  // A problem a webhook already reported (same dispute, same alert) keeps the
  // webhook's task; the polled duplicate is dropped.
  const live = c.derivedTasks.filter((t) => t.live);
  const covered = await existingEventKeys(live.flatMap((t) => (t.alias ? [t.alias] : [])));
  await reconcileDerived(live.filter((t) => !t.alias || !covered.has(t.alias)), ["connector", ...scopes], c.unobserved);

  for (const n of c.notifications) {
    if (!n.live) continue;
    await recordEvent({ dedupeKey: n.id, source: n.source, kind: n.id.split(":")[0], title: n.title, body: n.body, severity: n.severity, url: n.url, occurredAt: n.at });
  }

  if (c.modes.websites === "live") {
    for (const w of c.websites) await recordWebsite(w);
  }
  // Last known state per camera site: channel names for alarm webhooks, and
  // the Cameras page while a tunnel is down.
  if (c.modes.cameras === "live") {
    for (const site of c.cameras) await replaceSnapshot("cameras", site.id, site);
  }
  return true;
}

interface SiteSnapshot {
  status: Website["status"];
  responseMs: number | null;
  totalUsers: number | null;
  newUsers7d: number | null;
}

async function recordWebsite(w: Website) {
  const prev = await latestSnapshot<SiteSnapshot>("website", w.domain);
  const cur: SiteSnapshot = { status: w.status, responseMs: w.responseMs, totalUsers: w.totalUsers, newUsers7d: w.newUsers7d };
  await recordSnapshot("website", w.domain, cur);

  const changed = prev ? prev.status !== cur.status : cur.status !== "up";
  if (changed) {
    const recovered = cur.status === "up";
    await recordEvent({
      dedupeKey: `site:${w.domain}:${cur.status}:${new Date().toISOString()}`,
      source: "Website monitor",
      kind: "site",
      title: recovered ? `${w.domain} recovered` : cur.status === "down" ? `${w.domain} is down` : `${w.domain} is slow or erroring`,
      body: cur.responseMs != null ? `${cur.responseMs} ms` : "no response",
      severity: recovered ? "low" : cur.status === "down" ? "critical" : "high",
      url: `https://${w.domain}`,
      business: w.business,
    });
  }

  if (prev?.totalUsers != null && cur.totalUsers != null && cur.totalUsers > prev.totalUsers) {
    const added = cur.totalUsers - prev.totalUsers;
    await recordEvent({
      dedupeKey: `signup:${w.domain}:${cur.totalUsers}`,
      source: "Website monitor",
      kind: "signup",
      title: `${added} new sign-up${added > 1 ? "s" : ""} on ${w.domain}`,
      body: `${cur.totalUsers.toLocaleString()} users total`,
      severity: "low",
      url: `https://${w.domain}`,
      business: w.business,
    });
  }
}

/** Seconds after cron starts when no new domain check is started (the function may run 60 s). */
const DOMAIN_BUDGET_MS = 35_000;

/** Cron entry point: fresh collection, forced persist, domain checks, housekeeping. */
export async function runScheduledChecks() {
  const started = Date.now();
  const c = await collect();
  await persist(c, { force: true });
  // Domain checks hit RDAP/DNS/TLS (up to ~10 s each), so they run here, after
  // the sync that must not be starved, within a time budget; whatever is left
  // waits for the next run.
  const { domains, dkimSelectors } = await getConfig();
  const domainsChecked = await refreshDomainChecks(domains, dkimSelectors, { deadline: started + DOMAIN_BUDGET_MS });
  if (domainsChecked) await requestSync(); // let the next page view turn them into tasks
  // New mail gets read by Claude (when enabled); the next sync uses the result.
  const triaged = c.modes.inbox === "live" ? await triagePending(c.emails).catch(() => 0) : 0;
  if (triaged) await requestSync();
  // Notifications never fail the run: the sync above is what matters.
  const pushed = await pushNewCriticalTasks().catch((err) => (console.error(`[push] ${errorMessage(err)}`), 0));
  const reports = await sendScheduledReports(c).catch((err) => (console.error(`[reports] ${errorMessage(err)}`), [] as string[]));
  await pruneOldData();
  await setSetting("job:last_cron", { at: new Date().toISOString(), ms: Date.now() - started });
  return {
    ms: Date.now() - started,
    sources: c.sources.map((s) => ({ source: s.source, mode: s.mode, error: s.error, partial: s.partial })),
    tasks: c.derivedTasks.filter((t) => t.live).length,
    domainsChecked,
    triaged,
    pushed,
    reports,
  };
}
