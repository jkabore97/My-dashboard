import Link from "next/link";
import { Star } from "lucide-react";
import { getDashboard } from "@/lib/server/dashboard";
import { getConfig } from "@/lib/server/config";
import { snapshotHistory } from "@/lib/server/store/snapshots";
import { lastDays } from "@/lib/connectors/analytics";
import { weeklyChange } from "@/lib/growth";
import { today } from "@/lib/dates";
import { Card, Empty, PageHeader, Stat } from "@/components/ui";
import { LineChart, Sparkline } from "@/components/LineChart";
import type { DailyPoint } from "@/lib/types";

/** Registered users per day (last value seen that day) from uptime snapshots. */
async function userTrend(domain: string): Promise<DailyPoint[]> {
  const rows = await snapshotHistory<{ totalUsers: number | null }>("website", 30 * 24).catch(() => []);
  const byDay = new Map<string, number>();
  for (const r of rows) if (r.key === domain && r.data.totalUsers != null) byDay.set(r.takenAt.slice(0, 10), r.data.totalUsers);
  return [...byDay].map(([date, value]) => ({ date, value }));
}

function Change({ points }: { points: DailyPoint[] }) {
  const w = weeklyChange(points);
  if (!w) return null;
  const pct = Math.round(w.change * 100);
  return <span className={`text-xs tabular-nums ${pct <= -40 ? "text-critical" : pct < 0 ? "text-high" : "text-ok"}`}>{pct > 0 ? "+" : ""}{pct}% vs last week</span>;
}

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ site?: string }> }) {
  const { site } = await searchParams;
  const d = await getDashboard();
  const { sites } = await getConfig();
  const selected = d.analytics.find((a) => a.domain === site) ?? d.analytics.find((a) => a.traffic) ?? d.analytics[0];
  const trend = selected ? await userTrend(selected.domain) : [];
  const business = (domain: string) => sites.find((s) => s.domain === domain)?.business;
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

  return (
    <>
      <PageHeader mode={d.modes.analytics} title="Analytics" subtitle="Visitors from Google Analytics, search traffic from Search Console, and your Google reviews. Last 28 days." />

      <Card title="Sites">
        {d.analytics.length === 0 ? <Empty>Add websites in Settings, then connect a Google account with Analytics and Search Console access.</Empty> : (
          <ul className="-my-2 divide-y divide-line">
            {d.analytics.map((a) => (
              <li key={a.domain}>
                <Link href={`/analytics?site=${encodeURIComponent(a.domain)}`} className={`flex flex-wrap items-center gap-x-4 gap-y-1 py-3 hover:bg-panel-2/40 ${a.domain === selected?.domain ? "text-accent" : ""}`}>
                  <span className="min-w-0 flex-1 basis-48 text-sm">{a.domain}<span className="block text-xs text-muted">{business(a.domain) ?? ""}</span></span>
                  {a.traffic ? (
                    <>
                      <Sparkline points={a.traffic.sessions} />
                      <span className="w-28 text-right text-sm tabular-nums text-ink">{a.traffic.totals.sessions.toLocaleString()}<span className="block text-xs text-muted">sessions</span></span>
                      <span className="w-32 text-right"><Change points={a.traffic.sessions} /></span>
                    </>
                  ) : <span className="text-xs text-muted">No Analytics property matched this site</span>}
                  <span className="w-28 text-right text-sm tabular-nums text-ink">{a.search ? a.search.totals.clicks.toLocaleString() : "—"}<span className="block text-xs text-muted">search clicks</span></span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {selected && (
        <>
          <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wider text-muted">{selected.domain}</h2>
          {selected.traffic && (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="Sessions" value={selected.traffic.totals.sessions.toLocaleString()} hint={`${lastDays(selected.traffic.sessions, 7).toLocaleString()} this week`} />
              <Stat label="Visitors" value={selected.traffic.totals.users.toLocaleString()} hint={`${selected.traffic.totals.newUsers.toLocaleString()} new`} />
              <Stat label="Key events" value={selected.traffic.totals.keyEvents.toLocaleString()} hint="conversions you track in GA4" />
              <Stat label="Search clicks" value={selected.search ? selected.search.totals.clicks.toLocaleString() : "—"} hint={selected.search ? `${pct(selected.search.totals.ctr)} CTR · avg position ${selected.search.totals.position.toFixed(1)}` : "no Search Console property"} />
            </div>
          )}
          <div className="mt-4 grid gap-6 xl:grid-cols-2">
            <Card title="Sessions per day">{selected.traffic ? <LineChart points={selected.traffic.sessions} label="Sessions" /> : <Empty>No Analytics data for this site.</Empty>}</Card>
            <Card title="Search clicks per day">{selected.search ? <LineChart points={selected.search.clicks} label="Clicks" /> : <Empty>No Search Console data for this site.</Empty>}</Card>
            <Card title="Top pages">
              {selected.traffic?.topPages.length ? (
                <ul className="space-y-1.5 text-sm">{selected.traffic.topPages.map((p) => <li key={p.path} className="flex justify-between gap-3"><span className="truncate font-mono text-xs">{p.path}</span><span className="tabular-nums text-muted">{p.views.toLocaleString()}</span></li>)}</ul>
              ) : <Empty>No page data.</Empty>}
            </Card>
            <Card title="Top searches">
              {selected.search?.topQueries.length ? (
                <ul className="space-y-1.5 text-sm">{selected.search.topQueries.map((q) => <li key={q.query} className="flex justify-between gap-3"><span className="truncate">{q.query}</span><span className="shrink-0 tabular-nums text-muted">{q.clicks} clicks · #{q.position.toFixed(1)}</span></li>)}</ul>
              ) : <Empty>No search data.</Empty>}
            </Card>
            <Card className="xl:col-span-2" title="Registered users (from your Supabase sign-ups)">
              {trend.length > 1 ? <LineChart points={trend} label="Users" height={110} /> : <Empty>Builds up as the dashboard checks this site; needs a Supabase project ref in Settings → Websites.</Empty>}
            </Card>
          </div>
        </>
      )}

      <h2 id="reviews" className="mb-3 mt-10 scroll-mt-6 text-sm font-semibold uppercase tracking-wider text-muted">Google reviews</h2>
      {d.reviews.length === 0 ? <Card><Empty>Set GOOGLE_PLACES_API_KEY and add your Google place IDs in Settings to see ratings and reviews.</Empty></Card> : (
        <div className="grid gap-4 lg:grid-cols-2">
          {d.reviews.map((p) => (
            <Card key={p.placeId} title={p.url ? <a href={p.url} target="_blank" rel="noreferrer" className="hover:text-accent">{p.name}</a> : p.name} action={<span className="flex items-center gap-1 text-sm tabular-nums"><Star size={14} className="fill-medium text-medium" />{p.rating?.toFixed(1) ?? "—"}<span className="text-xs text-muted">({p.reviewCount.toLocaleString()})</span></span>}>
              {p.reviews.length === 0 ? <Empty>No reviews returned.</Empty> : (
                <ul className="-my-2 divide-y divide-line">
                  {p.reviews.map((r) => (
                    <li key={r.id} className="py-2.5">
                      <div className="flex items-baseline justify-between gap-2 text-sm">
                        <span className={r.rating <= 3 ? "text-high" : ""} aria-label={`${r.rating} out of 5 stars`}>{"★".repeat(r.rating)}<span className="text-line">{"★".repeat(5 - r.rating)}</span> <span className="text-ink">{r.author}</span></span>
                        <span className="shrink-0 text-xs text-muted">{r.relative ?? r.publishedAt.slice(0, 10)}</span>
                      </div>
                      {r.text && <p className="mt-1 text-sm text-muted">{r.text}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ))}
        </div>
      )}
      <p className="mt-3 text-xs text-muted">Google shares up to 5 reviews per place through its API, so very busy listings may have more than shown. As of {today()}.</p>
    </>
  );
}
