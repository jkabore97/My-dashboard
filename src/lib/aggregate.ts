import { cache } from "react";
import { getCloudflareD1, getCloudflareWorkers } from "./connectors/cloudflare";
import { getEmails } from "./connectors/gmail";
import { getGithubNotifications, getRepos } from "./connectors/github";
import { getSupabaseProjects } from "./connectors/supabase";
import { getVercelProjects } from "./connectors/vercel";
import { getWebsites } from "./connectors/websites";
import { demoManualTasks } from "./demo";
import { getPlatforms } from "./platforms";
import { SEVERITY_ORDER, type Notification, type SourceResult, type Task } from "./types";

const DAY = 86_400_000;

// One fetch of everything per request; every page reads from this.
export const getSnapshot = cache(async () => {
  const [repos, ghNotes, vercel, workers, supabase, d1, emails] = await Promise.all([
    getRepos(),
    getGithubNotifications(),
    getVercelProjects(),
    getCloudflareWorkers(),
    getSupabaseProjects(),
    getCloudflareD1(),
    getEmails(),
  ]);
  const hosting = [...vercel.data, ...workers.data];
  const websites = await getWebsites(hosting);
  const databases = [...supabase.data, ...d1.data];

  const sources: SourceResult<unknown>[] = [repos, vercel, workers, supabase, d1, emails, websites];
  const allDemo = sources.every((s) => s.mode === "demo");

  const tasks = deriveTasks({ repos: repos.data, hosting, databases, emails: emails.data, websites: websites.data, sources });
  if (allDemo) tasks.push(...demoManualTasks());
  tasks.sort(bySeverityThenTime);

  const notifications: Notification[] = [
    ...emails.data.map((e) => ({ id: e.id, source: `Email · ${e.account}`, title: e.subject, body: e.from, at: e.receivedAt, severity: e.severity, url: e.url })),
    ...ghNotes.data,
    ...hosting
      .filter((h) => h.lastDeployAt)
      .map((h) => ({
        id: `deploy-${h.id}`,
        source: h.provider === "vercel" ? "Vercel" : "Cloudflare",
        title: `${h.name}: deploy ${h.lastDeployState ?? "updated"}`,
        at: h.lastDeployAt!,
        severity: h.lastDeployState === "error" ? ("critical" as const) : ("low" as const),
        url: h.url ?? undefined,
      })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  const modes = {
    GitHub: repos.mode,
    Vercel: vercel.mode,
    Cloudflare: workers.mode === "error" || d1.mode === "error" ? "error" : workers.mode,
    Supabase: supabase.mode,
    Gmail: emails.mode,
    Website: websites.mode,
  } as const;

  return {
    repos: repos.data,
    hosting,
    databases,
    emails: emails.data,
    websites: websites.data,
    tasks,
    notifications,
    platforms: getPlatforms(modes),
    sources: sources.map(({ source, mode, error, fetchedAt }) => ({ source, mode, error, fetchedAt })),
    allDemo,
  };
});

export type Snapshot = Awaited<ReturnType<typeof getSnapshot>>;

function bySeverityThenTime(a: Task, b: Task) {
  return SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) || b.createdAt.localeCompare(a.createdAt);
}

// Turns raw signals from every platform into one prioritized to-do list.
function deriveTasks(s: {
  repos: Snapshot["repos"];
  hosting: Snapshot["hosting"];
  databases: Snapshot["databases"];
  emails: Snapshot["emails"];
  websites: Snapshot["websites"];
  sources: SourceResult<unknown>[];
}): Task[] {
  const now = new Date().toISOString();
  const tasks: Task[] = [];

  for (const src of s.sources) {
    if (src.mode === "error") {
      tasks.push({ id: `src-${src.source}`, title: `Fix the ${src.source} connection`, detail: src.error, severity: "high", source: "Dashboard", createdAt: now });
    }
  }

  for (const w of s.websites) {
    if (w.status === "down") tasks.push({ id: `site-${w.id}`, title: `${w.domain} is down`, detail: "Site did not respond within 8s", severity: "critical", source: "Website monitor", url: `https://${w.domain}`, createdAt: now, business: w.business });
    else if (w.status === "degraded") tasks.push({ id: `site-${w.id}`, title: `${w.domain} is slow or erroring`, detail: w.responseMs ? `${w.responseMs} ms response` : undefined, severity: "high", source: "Website monitor", url: `https://${w.domain}`, createdAt: now, business: w.business });
  }

  for (const h of s.hosting) {
    if (h.lastDeployState === "error") {
      tasks.push({ id: `deploy-${h.id}`, title: `Production deploy failed: ${h.name}`, severity: "critical", source: h.provider === "vercel" ? "Vercel" : "Cloudflare", url: h.provider === "vercel" ? `https://vercel.com/dashboard` : undefined, createdAt: h.lastDeployAt ?? now, business: h.business });
    }
  }

  for (const d of s.databases) {
    for (const [i, a] of (d.advisories ?? []).entries()) {
      if (a.level === "low") continue;
      tasks.push({ id: `adv-${d.id}-${i}`, title: `${d.name}: ${a.title}`, severity: a.level, source: "Supabase advisor", url: d.provider === "supabase" ? `https://supabase.com/dashboard/project/${d.id}/advisors/security` : undefined, createdAt: now, business: d.business });
    }
    if (d.status === "paused") tasks.push({ id: `paused-${d.id}`, title: `${d.name} is paused — restore or delete it`, severity: "low", source: "Supabase", createdAt: d.createdAt ?? now, business: d.business });
    if (d.status === "degraded") tasks.push({ id: `deg-${d.id}`, title: `${d.name} database is unhealthy`, severity: "critical", source: "Supabase", createdAt: now, business: d.business });
  }

  for (const e of s.emails) {
    if (e.unread && (e.severity === "critical" || e.severity === "high" || e.severity === "medium")) {
      tasks.push({ id: `mail-${e.id}`, title: e.subject, detail: `From ${e.from}`, severity: e.severity, source: `Email · ${e.account}`, url: e.url, createdAt: e.receivedAt, business: e.account });
    }
  }

  for (const r of s.repos) {
    if (r.openPullRequests > 0) tasks.push({ id: `pr-${r.id}`, title: `Review ${r.openPullRequests} open PR${r.openPullRequests > 1 ? "s" : ""} in ${r.name}`, severity: "medium", source: "GitHub", url: `${r.url}/pulls`, createdAt: r.pushedAt, business: r.business });
    if (r.openIssues >= 10) tasks.push({ id: `iss-${r.id}`, title: `Triage ${r.openIssues} open issues in ${r.name}`, severity: "medium", source: "GitHub", url: `${r.url}/issues`, createdAt: r.pushedAt, business: r.business });
    if (Date.now() - Date.parse(r.pushedAt) > 30 * DAY && r.openIssues + r.openPullRequests > 0) {
      tasks.push({ id: `stale-${r.id}`, title: `${r.name} has open work but no pushes in 30+ days`, severity: "low", source: "GitHub", url: r.url, createdAt: r.pushedAt, business: r.business });
    }
  }

  return tasks;
}
