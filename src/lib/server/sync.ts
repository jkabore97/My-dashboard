import { collect, type Collected } from "../aggregate";
import type { Website } from "../types";
import { recordEvent } from "./store/events";
import { pruneOldData } from "./store/maintenance";
import { claimInterval, setSetting } from "./store/settings";
import { latestSnapshot, recordSnapshot } from "./store/snapshots";
import { reconcileDerived } from "./store/tasks";

const PAGE_SYNC_SECONDS = 60;

/**
 * Persists what the latest collection saw: derived tasks, new events and
 * website health snapshots. Throttled so concurrent page loads don't repeat
 * the work; cron passes force.
 */
export async function persist(c: Collected, { force = false } = {}) {
  if (!(await claimInterval("job:sync", force ? 0 : PAGE_SYNC_SECONDS))) return false;

  // Only live data is persisted; demo/errored sources would pollute history.
  // Reconciliation is limited to scopes that answered, so a source that is
  // temporarily failing doesn't auto-resolve the tasks it couldn't see.
  const liveScopes = (Object.entries(c.modes) as [string, string][]).filter(([, m]) => m === "live").map(([k]) => k);
  await reconcileDerived(c.derivedTasks.filter((t) => t.live), ["connector", ...liveScopes]);

  for (const n of c.notifications) {
    if (!n.live) continue;
    await recordEvent({ dedupeKey: n.id, source: n.source, kind: n.id.split(":")[0], title: n.title, body: n.body, severity: n.severity, url: n.url, occurredAt: n.at });
  }

  if (c.modes.websites === "live") {
    for (const w of c.websites) await recordWebsite(w);
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

/** Cron entry point: fresh collection, forced persist, housekeeping. */
export async function runScheduledChecks() {
  const started = Date.now();
  const c = await collect();
  await persist(c, { force: true });
  await pruneOldData();
  await setSetting("job:last_cron", { at: new Date().toISOString(), ms: Date.now() - started });
  return {
    ms: Date.now() - started,
    sources: c.sources.map((s) => ({ source: s.source, mode: s.mode, error: s.error })),
    tasks: c.derivedTasks.filter((t) => t.live).length,
  };
}
