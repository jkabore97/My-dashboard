import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { getSnapshot } from "@/lib/aggregate";
import { Card, ModePill, PageHeader, SeverityBadge, Stat, StatusDot, timeAgo } from "@/components/ui";
import { TaskRow } from "@/components/TaskRow";

export default async function Overview() {
  const s = await getSnapshot();
  const critical = s.tasks.filter((t) => t.severity === "critical").length;
  const high = s.tasks.filter((t) => t.severity === "high").length;
  const unread = s.emails.filter((e) => e.unread).length;
  const failing = s.hosting.filter((h) => h.lastDeployState === "error").length;
  const sitesUp = s.websites.filter((w) => w.status === "up").length;
  const users = s.websites.reduce((n, w) => n + (w.totalUsers ?? 0), 0);
  const newUsers = s.websites.reduce((n, w) => n + (w.newUsers7d ?? 0), 0);

  const businesses = [...new Set([...s.repos, ...s.hosting, ...s.databases, ...s.websites].map((x) => x.business ?? "Unassigned"))].sort();

  return (
    <>
      <PageHeader title="Good to see you" subtitle={`${critical} critical and ${high} high-priority items across ${businesses.length} businesses.`} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Critical" value={critical} tone={critical ? "critical" : "ok"} hint="needs you today" />
        <Stat label="High" value={high} tone={high ? "high" : "ok"} hint="this week" />
        <Stat label="Unread email" value={unread} hint={`${s.emails.length} in last 14 days`} />
        <Stat label="Failed deploys" value={failing} tone={failing ? "critical" : "ok"} hint={`${s.hosting.length} projects`} />
        <Stat label="Sites up" value={`${sitesUp}/${s.websites.length}`} tone={sitesUp === s.websites.length ? "ok" : "high"} />
        <Stat label="Users" value={users.toLocaleString()} hint={`+${newUsers} this week`} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-5">
        <Card className="xl:col-span-3" title="What needs you" action={<Link href="/tasks" className="text-xs text-accent hover:underline">All {s.tasks.length} →</Link>}>
          <ul className="-my-2 divide-y divide-line">
            {s.tasks.slice(0, 8).map((t) => <TaskRow key={t.id} task={t} />)}
          </ul>
        </Card>

        <Card className="xl:col-span-2" title="Latest notifications" action={<Link href="/notifications" className="text-xs text-accent hover:underline">All →</Link>}>
          <ul className="-my-2 divide-y divide-line">
            {s.notifications.slice(0, 8).map((n) => (
              <li key={n.id} className="flex items-start gap-3 py-2.5">
                <SeverityBadge severity={n.severity} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{n.title}</div>
                  <div className="truncate text-xs text-muted">{n.source} · {timeAgo(n.at)}</div>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wider text-muted">By business</h2>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {businesses.map((b) => {
          const is = (x: { business?: string }) => (x.business ?? "Unassigned") === b;
          const t = s.tasks.filter(is);
          const sites = s.websites.filter(is);
          return (
            <Card key={b} title={b} action={<Link href={`/tasks?business=${encodeURIComponent(b)}`} className="text-xs text-accent hover:underline">Tasks →</Link>}>
              <dl className="grid grid-cols-4 gap-2 text-center text-xs text-muted">
                <div><dt>Repos</dt><dd className="text-lg font-semibold text-ink">{s.repos.filter(is).length}</dd></div>
                <div><dt>Hosts</dt><dd className="text-lg font-semibold text-ink">{s.hosting.filter(is).length}</dd></div>
                <div><dt>DBs</dt><dd className="text-lg font-semibold text-ink">{s.databases.filter(is).length}</dd></div>
                <div><dt>Open</dt><dd className={`text-lg font-semibold ${t.some((x) => x.severity === "critical") ? "text-critical" : "text-ink"}`}>{t.length}</dd></div>
              </dl>
              {sites.length > 0 && (
                <ul className="mt-4 space-y-1.5 border-t border-line pt-3 text-sm">
                  {sites.map((w) => (
                    <li key={w.id} className="flex items-center gap-2">
                      <StatusDot status={w.status === "up" ? "ok" : w.status === "down" ? "bad" : "warn"} />
                      <a href={`https://${w.domain}`} target="_blank" rel="noreferrer" className="flex-1 truncate hover:text-accent">{w.domain}</a>
                      <span className="text-xs text-muted">{w.totalUsers?.toLocaleString() ?? "—"} users</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          );
        })}
      </div>

      <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wider text-muted">Connections</h2>
      <div className="flex flex-wrap gap-2">
        {s.platforms.filter((p) => p.available).map((p) => (
          <Link key={p.id} href="/platforms" className="flex items-center gap-2 rounded-lg border border-line bg-panel px-3 py-2 text-sm hover:border-accent/50">
            {p.name} <ModePill mode={p.mode} /> <ArrowUpRight size={12} className="text-muted" />
          </Link>
        ))}
      </div>
    </>
  );
}
