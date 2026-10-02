import { requireSection } from "@/lib/server/auth";
import Link from "next/link";
import { getDashboard } from "@/lib/server/dashboard";
import { getConfig } from "@/lib/server/config";
import { snapshotHistory } from "@/lib/server/store/snapshots";
import { lastDays } from "@/lib/connectors/analytics";
import { weeklyChange } from "@/lib/growth";
import { formatDate, today } from "@/lib/dates";
import { BizLabel, Card, Empty, PageHeader } from "@/components/ui";
import { LineChart, Sparkline } from "@/components/LineChart";
import { MeterStat, SubHead } from "@/components/web/hud";
import type { DailyPoint } from "@/lib/types";

/** Registered users per day (last value seen that day) from uptime snapshots. */
async function userTrend(domain: string): Promise<DailyPoint[]> {
  const rows = await snapshotHistory<{ totalUsers: number | null }>("website", 30 * 24).catch(() => []);
  const byDay = new Map<string, number>();
  for (const r of rows) if (r.key === domain && r.data.totalUsers != null) byDay.set(r.takenAt.slice(0, 10), r.data.totalUsers);
  return [...byDay].map(([date, value]) => ({ date, value }));
}

const SITE_COLORS = ["#2ef2d0", "#ff5fd7", "#3fd0ff", "#a98bff", "#c6f432", "#ffd84d", "#3df5a0", "#7aa2ff"];

function Change({ points }: { points: DailyPoint[] }) {
  const w = weeklyChange(points);
  if (!w) return null;
  const pct = Math.round(w.change * 100);
  return <span className={`font-mono text-xs tabular-nums ${pct <= -40 ? "text-critical" : pct < 0 ? "text-high" : "text-emerald"}`}>{pct > 0 ? "+" : pct < 0 ? "−" : ""}{Math.abs(pct)}% vs last week</span>;
}

function Stars({ rating }: { rating: number }) {
  const r = Math.max(0, Math.min(5, Math.round(rating)));
  return <span aria-label={`${r} out of 5 stars`} className={r <= 3 ? "text-high" : "text-gold"}>{"★".repeat(r)}<span className="text-line">{"★".repeat(5 - r)}</span></span>;
}

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ site?: string }> }) {
  await requireSection("analytics");
  const { site } = await searchParams;
  const d = await getDashboard();
  const { sites } = await getConfig();
  const selected = d.analytics.find((a) => a.domain === site) ?? d.analytics.find((a) => a.traffic) ?? d.analytics[0];
  const trend = selected ? await userTrend(selected.domain) : [];
  const business = (domain: string) => sites.find((s) => s.domain === domain)?.business ?? d.websites.find((w) => w.domain === domain)?.business;
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const color = (domain: string) => SITE_COLORS[Math.max(0, d.analytics.findIndex((a) => a.domain === domain)) % SITE_COLORS.length];
  const peak = selected?.traffic?.sessions.reduce((a, b) => (b.value > a.value ? b : a), selected.traffic.sessions[0]);
  const fmtDay = (s: string) => new Date(`${s}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });

  return (
    <>
      <PageHeader mode={d.modes.analytics} title="Analytics" subtitle="Visitors from Google Analytics, search traffic from Search Console, and your Google reviews. Last 28 days." />

      <Card accent="teal" flush title="Sites" action="select a site · sessions trend · search clicks">
        {d.analytics.length === 0 ? <Empty>Add websites in Settings, then connect a Google account with Analytics and Search Console access.</Empty> : (
          <ul className="divide-y divide-line/60">
            {d.analytics.map((a) => {
              const on = a.domain === selected?.domain;
              return (
                <li key={a.domain}>
                  <Link
                    href={`/analytics?site=${encodeURIComponent(a.domain)}`}
                    aria-current={on ? "true" : undefined}
                    className={`grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 border-l-2 px-4 py-2.5 sm:px-5 md:grid-cols-[minmax(0,1fr)_150px_6rem_9.5rem_6rem] ${on ? "border-teal bg-teal/[0.06]" : "border-transparent hover:bg-white/[0.02]"}`}
                  >
                    <span className="min-w-0 text-[13px]"><span className={`block truncate ${on ? "text-teal" : "text-[#eaf7ff]"}`}>{a.domain}</span><span className="block truncate text-[11px] text-muted">{business(a.domain) ?? ""}</span></span>
                    {a.traffic ? (
                      <>
                        <span className="hidden md:block"><Sparkline points={a.traffic.sessions} width={150} height={30} color={color(a.domain)} /></span>
                        <span className="text-right font-mono text-[13px] tabular-nums text-ink">{a.traffic.totals.sessions.toLocaleString()}<span className="block font-sans text-[11px] text-muted">sessions</span></span>
                        <span className="hidden text-right md:block"><Change points={a.traffic.sessions} /></span>
                      </>
                    ) : <span className="text-right text-xs text-muted md:col-span-3 md:text-left">No Analytics property matched this site</span>}
                    <span className="hidden text-right font-mono text-[13px] tabular-nums text-ink md:block">{a.search ? a.search.totals.clicks.toLocaleString() : <span className="text-muted">—</span>}<span className="block font-sans text-[11px] text-muted">search clicks</span></span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {selected && (
        <>
          <SubHead color="#2ef2d0"><span className="flex flex-wrap items-center gap-3 normal-case">{selected.domain}<BizLabel name={business(selected.domain)} className="font-sans tracking-normal" /></span></SubHead>
          {selected.traffic && (
            <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-5">
              <MeterStat accent="teal" tone="teal" label="Sessions" value={selected.traffic.totals.sessions.toLocaleString()} hint={`${lastDays(selected.traffic.sessions, 7).toLocaleString()} this week`} />
              <MeterStat accent="cyan" tone="cyan" label="Visitors" value={selected.traffic.totals.users.toLocaleString()} hint={`${selected.traffic.totals.newUsers.toLocaleString()} new`} />
              <MeterStat accent="gold" tone="gold" label="Key events" value={selected.traffic.totals.keyEvents.toLocaleString()} hint="conversions you track in GA4" />
              <MeterStat accent="pink" tone="pink" label="Search clicks" value={selected.search ? selected.search.totals.clicks.toLocaleString() : "—"} hint={selected.search ? `${pct(selected.search.totals.ctr)} CTR · avg position ${selected.search.totals.position.toFixed(1)}` : "no Search Console property"} />
            </div>
          )}
          <div className="grid gap-5 xl:grid-cols-2">
            <Card accent="teal" title="Sessions per day" action={peak ? `peak ${peak.value.toLocaleString()} · ${fmtDay(peak.date)}` : undefined}>
              {selected.traffic ? <LineChart points={selected.traffic.sessions} label="Sessions" color="#2ef2d0" area peak={false} height={160} /> : <Empty>No Analytics data for this site.</Empty>}
            </Card>
            <Card accent="pink" title="Search clicks per day" action="Search Console">
              {selected.search ? <LineChart points={selected.search.clicks} label="Clicks" color="#ff5fd7" area peak={false} height={160} /> : <Empty>No Search Console data for this site.</Empty>}
            </Card>
            <Card accent="cyan" title="Top pages" action="views">
              {selected.traffic?.topPages.length ? (
                <ul className="space-y-2.5">
                  {selected.traffic.topPages.map((p) => (
                    <li key={p.path} className="grid grid-cols-[minmax(0,1fr)_5rem_4rem] items-center gap-3 sm:grid-cols-[minmax(0,1fr)_8rem_4.5rem]">
                      <span className="truncate font-mono text-xs" title={p.path}>{p.path}</span>
                      <span className="h-1.5 bg-white/5"><span className="block h-full bg-gradient-to-r from-cyan to-cyan/30 shadow-[0_0_6px_#3fd0ff]" style={{ width: `${(p.views / Math.max(1, selected.traffic!.topPages[0].views)) * 100}%` }} /></span>
                      <span className="text-right font-mono text-xs tabular-nums">{p.views.toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
              ) : <Empty>No page data.</Empty>}
            </Card>
            <Card accent="violet" title="Top searches" action="clicks · position">
              {selected.search?.topQueries.length ? (
                <ul className="space-y-2.5">
                  {selected.search.topQueries.map((q) => (
                    <li key={q.query} className="grid grid-cols-[minmax(0,1fr)_4rem_5.5rem] items-center gap-3 text-[13px] sm:grid-cols-[minmax(0,1fr)_8rem_6rem]">
                      <span className="truncate" title={q.query}>{q.query}</span>
                      <span className="h-1.5 bg-white/5"><span className="block h-full bg-gradient-to-r from-violet to-violet/30 shadow-[0_0_6px_#a98bff]" style={{ width: `${(q.clicks / Math.max(1, ...selected.search!.topQueries.map((x) => x.clicks))) * 100}%` }} /></span>
                      <span className="text-right font-mono text-xs tabular-nums">{q.clicks.toLocaleString()} <span className="text-muted">#{q.position.toFixed(1)}</span></span>
                    </li>
                  ))}
                </ul>
              ) : <Empty>No search data.</Empty>}
            </Card>
            <Card accent="lime" className="xl:col-span-2" title="Registered users · from your Supabase sign-ups" action={trend.length > 1 ? `${trend[trend.length - 1].value.toLocaleString()} total` : undefined}>
              {trend.length > 1 ? <LineChart points={trend} label="Users" height={110} color="#c6f432" area /> : <Empty>Builds up as the dashboard checks this site; needs a Supabase project ref in Settings → Websites.</Empty>}
            </Card>
          </div>
        </>
      )}

      <div id="reviews" className="scroll-mt-6"><SubHead color="#ffd84d">Google reviews</SubHead></div>
      {d.reviews.length === 0 ? <Card accent="gold"><Empty>Set GOOGLE_PLACES_API_KEY and add your Google place IDs in Settings to see ratings and reviews.</Empty></Card> : (
        <div className="grid gap-5 lg:grid-cols-2">
          {d.reviews.map((p) => (
            <Card
              key={p.placeId}
              accent="gold"
              flush
              title={p.url ? <a href={p.url} target="_blank" rel="noreferrer" className="hover:underline">{p.name}</a> : p.name}
              action={<span className="flex items-center gap-1.5 font-display text-base normal-case tracking-normal text-gold"><span aria-hidden>★</span><span className="tabular-nums">{p.rating?.toFixed(1) ?? "—"}</span><span className="font-mono text-[11px] text-muted">({p.reviewCount.toLocaleString()})</span></span>}
            >
              {p.reviews.length === 0 ? <Empty>No reviews returned.</Empty> : (
                <ul className="divide-y divide-line/60">
                  {p.reviews.map((r) => (
                    <li key={r.id} className="px-4 py-3 sm:px-5">
                      <div className="flex items-baseline justify-between gap-3 text-[13px]">
                        <span><Stars rating={r.rating} /> <span className="ml-1 text-ink">{r.author}</span></span>
                        <span className="shrink-0 text-xs text-muted">{r.relative ?? formatDate(r.publishedAt.slice(0, 10))}</span>
                      </div>
                      {r.text && <p className="mt-1 text-[13px] leading-relaxed text-muted">{r.text}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ))}
        </div>
      )}
      <p className="mt-3 text-xs text-muted">Google shares up to 5 reviews per place through its API, so very busy listings may have more than shown. As of {formatDate(today())}.</p>
    </>
  );
}
