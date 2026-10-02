import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { getDashboard } from "@/lib/server/dashboard";
import { Card, Empty, ModePill, PageHeader, SeverityBadge, Stat, StatusDot, timeAgo } from "@/components/ui";
import { TaskRow } from "@/components/TaskRow";
import { businessTimeZone, today } from "@/lib/dates";
import { todaysEvents } from "@/lib/agenda";
import { OPEN_STAGES } from "@/lib/server/store/pipeline";
import { formatTotals, sumByCurrency } from "@/lib/money";
import { moneyByBusiness, moneyOverview } from "@/lib/money-summary";
import { canSee, isFullOwner } from "@/lib/access";

export default async function Overview({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const { denied } = await searchParams;
  const s = await getDashboard();
  const can = (x: Parameters<typeof canSee>[1]) => canSee(s.user, x);
  const critical = s.openTasks.filter((t) => t.severity === "critical").length;
  const high = s.openTasks.filter((t) => t.severity === "high").length;
  const unread = s.emails.filter((e) => e.unread).length;
  const failing = s.hosting.filter((h) => h.lastDeployState === "error").length;
  const sitesUp = s.websites.filter((w) => w.status === "up").length;
  const users = s.websites.reduce((n, w) => n + (w.totalUsers ?? 0), 0);
  const newUsers = s.websites.reduce((n, w) => n + (w.newUsers7d ?? 0), 0);

  const now = today();
  const tz = businessTimeZone();
  const upcoming = todaysEvents(s.calendar, tz);
  const visitors7d = s.websites.reduce((n, w) => n + (w.visitors7d ?? 0), 0);
  const openDeals = s.records.deals.filter((x) => OPEN_STAGES.includes(x.stage));
  const pipeline = sumByCurrency(openDeals.filter((x) => x.valueMinor != null).map((x) => ({ currency: x.currency, amount: x.valueMinor! })));
  const followUps = openDeals.filter((x) => x.nextStepDue && x.nextStepDue <= now).length;
  const rated = s.reviews.filter((p) => p.rating != null && p.reviewCount > 0);
  const rating = rated.length ? rated.reduce((n, p) => n + p.rating! * p.reviewCount, 0) / rated.reduce((n, p) => n + p.reviewCount, 0) : null;
  const samples = { samples: s.modes.stripe !== "live" };
  const money = moneyOverview(s.stripe, s.records, now, samples);
  const byBusiness = moneyByBusiness(s.stripe, s.records, now, samples);
  const businesses = [...new Set([...[...s.repos, ...s.hosting, ...s.databases, ...s.websites, ...s.openTasks].map((x) => x.business ?? "Unassigned"), ...byBusiness.keys()])].sort();

  return (
    <>
      <PageHeader title="Overview" subtitle={`${critical} critical and ${high} high-priority items across ${businesses.length} businesses.`} />
      {denied && <p className="mb-4 rounded-lg border border-high/40 bg-high/10 px-4 py-2 text-sm">That page isn&apos;t part of your role. Ask an owner if you need it.</p>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Critical" value={critical} tone={critical ? "critical" : "ok"} hint="needs you today" />
        <Stat label="High" value={high} tone={high ? "high" : "ok"} hint="this week" />
        {can("inbox") && <Stat label="Unread email" value={unread} hint={`${s.emails.length} in last 14 days`} />}
        {can("hosting") && <Stat label="Failed deploys" value={failing} tone={failing ? "critical" : "ok"} hint={`${s.hosting.length} projects`} />}
        {can("websites") && <Stat label="Sites up" value={`${sitesUp}/${s.websites.length}`} tone={sitesUp === s.websites.length ? "ok" : "high"} />}
        {can("websites") && <Stat label="Users" value={users.toLocaleString()} hint={`+${newUsers} this week`} />}
      </div>

      {can("money") && <Link href="/money" className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Revenue (30d)" value={formatTotals(money.gross30d.slice(0, 1), { compact: true })} hint={s.modes.stripe === "live" ? "all Stripe accounts" : "sample data"} />
        <Stat label="MRR" value={formatTotals(money.mrr.slice(0, 1), { compact: true })} />
        <Stat label="Overdue invoices" value={money.overdueCount} tone={money.overdueCount ? "high" : "ok"} hint={money.overdueCount ? formatTotals(money.overdue, { compact: true }) : "all paid on time"} />
        <Stat label="Monthly spend" value={formatTotals(money.monthlySpend.slice(0, 1), { compact: true })} hint={`${money.spend.length} subscriptions`} />
      </Link>}

      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        {can("analytics") && <Link href="/analytics"><Stat label="Visitors (7d)" value={visitors7d.toLocaleString()} hint={s.modes.analytics === "live" ? "Google Analytics" : "sample data"} /></Link>}
        {can("clients") && <Link href="/clients"><Stat label="Open pipeline" value={formatTotals(pipeline.slice(0, 1), { compact: true })} hint={`${openDeals.length} deal${openDeals.length === 1 ? "" : "s"}`} /></Link>}
        {can("clients") && <Link href="/clients"><Stat label="Follow-ups due" value={followUps} tone={followUps ? "high" : "ok"} hint="today or overdue" /></Link>}
        {can("analytics") && <Link href="/analytics#reviews"><Stat label="Google rating" value={rating ? rating.toFixed(1) : "—"} hint={s.reviews.length ? `${s.reviews.reduce((n, p) => n + p.reviewCount, 0).toLocaleString()} reviews` : "not connected"} /></Link>}
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-5">
        <Card className="xl:col-span-3" title="What needs you" action={<Link href="/tasks" className="text-xs text-accent hover:underline">All {s.openTasks.length} →</Link>}>
          <ul className="-my-2 divide-y divide-line">
            {s.openTasks.length === 0 ? <Empty>Nothing needs you right now.</Empty> : s.openTasks.slice(0, 8).map((t) => <TaskRow key={t.id} task={t} compact />)}
          </ul>
        </Card>

        <div className="grid content-start gap-6 xl:col-span-2">
          {can("agenda") && <Card title="Coming up today" action={<Link href="/agenda" className="text-xs text-accent hover:underline">Agenda →</Link>}>
            {upcoming.length === 0 ? <Empty>No more meetings today.</Empty> : (
              <ul className="-my-2 divide-y divide-line">
                {upcoming.slice(0, 5).map((e) => (
                  <li key={e.id} className="flex items-baseline gap-3 py-2.5">
                    <span className="w-20 shrink-0 text-xs tabular-nums text-muted">{e.allDay ? "All day" : new Date(e.start).toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" })}</span>
                    <span className="min-w-0 flex-1 truncate text-sm">{e.meetingUrl ? <a href={e.meetingUrl} target="_blank" rel="noreferrer" className="hover:text-accent">{e.title}</a> : e.title}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>}

          <Card title="Latest notifications" action={can("notifications") ? <Link href="/notifications" className="text-xs text-accent hover:underline">All →</Link> : null}>
            <ul className="-my-2 divide-y divide-line">
              {s.notifications.slice(0, 8).map((n) => (
                <li key={n.id} className="flex items-start gap-3 py-2.5">
                  <SeverityBadge severity={n.severity} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">{n.url ? <a href={n.url} target="_blank" rel="noreferrer" className="hover:text-accent">{n.title}</a> : n.title}</div>
                    <div className="truncate text-xs text-muted">{n.source} · {timeAgo(n.at)}</div>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wider text-muted">By business</h2>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {businesses.map((b) => {
          const is = (x: { business?: string }) => (x.business ?? "Unassigned") === b;
          const t = s.openTasks.filter(is);
          const sites = s.websites.filter(is);
          return (
            <Card key={b} title={b} action={<Link href={`/tasks?business=${encodeURIComponent(b)}`} className="text-xs text-accent hover:underline">Tasks →</Link>}>
              <dl className="grid grid-cols-4 gap-2 text-center text-xs text-muted">
                <div><dt>Repos</dt><dd className="text-lg font-semibold text-ink">{s.repos.filter(is).length}</dd></div>
                <div><dt>Hosts</dt><dd className="text-lg font-semibold text-ink">{s.hosting.filter(is).length}</dd></div>
                <div><dt>DBs</dt><dd className="text-lg font-semibold text-ink">{s.databases.filter(is).length}</dd></div>
                <div><dt>Open</dt><dd className={`text-lg font-semibold ${t.some((x) => x.severity === "critical") ? "text-critical" : "text-ink"}`}>{t.length}</dd></div>
              </dl>
              {can("money") && byBusiness.get(b) && (
                <div className="mt-3 flex justify-between border-t border-line pt-3 text-xs text-muted">
                  <span>Revenue 30d <span className="text-ink tabular-nums">{formatTotals(byBusiness.get(b)!.revenue, { compact: true })}</span></span>
                  <span>Spend <span className="text-ink tabular-nums">{formatTotals(byBusiness.get(b)!.spend, { compact: true })}</span>/mo</span>
                </div>
              )}
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

      {isFullOwner(s.user) && <>
      <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wider text-muted">Connections</h2>
      <div className="flex flex-wrap gap-2">
        {s.platforms.filter((p) => p.mode).map((p) => (
          <Link key={p.id} href="/platforms" className="flex items-center gap-2 rounded-lg border border-line bg-panel px-3 py-2 text-sm hover:border-accent/50">
            {p.name} <ModePill mode={p.mode!} /> <ArrowUpRight size={12} className="text-muted" />
          </Link>
        ))}
      </div>
      </>}
    </>
  );
}
