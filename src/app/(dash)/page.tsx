import Link from "next/link";
import { combinedSpend } from "@/lib/billing/spend";
import type { CSSProperties } from "react";
import { getDashboard } from "@/lib/server/dashboard";
import { snapshotHistory } from "@/lib/server/store/snapshots";
import { Card, Empty, ModePill, SeverityBadge, timeAgo } from "@/components/ui";
import { businessTimeZone, today } from "@/lib/dates";
import { todaysEvents } from "@/lib/agenda";
import { OPEN_STAGES } from "@/lib/server/store/pipeline";
import { formatMoney, formatTotals, minorUnits, sumByCurrency, type CurrencyAmount } from "@/lib/money";
import { dailyRevenue, moneyOverview } from "@/lib/money-summary";
import { canSee } from "@/lib/access";
import { samplesEnabled } from "@/lib/source";
import type { SourceMode } from "@/lib/types";
import { ReactorLegend } from "@/components/command/Reactor";
import { ReactorDial } from "@/components/command/ReactorDial";
import { knownBusinesses } from "@/lib/server/reports";
import { CameraTiles, MoneyCell, QueueRow, SolarSummary, Sparkline, UptimeRow } from "@/components/command/OverviewPanels";
import { businessRing, topLines, type UptimePoint } from "@/components/command/logic";
import { KV } from "@/components/command/hud";

/** Whole units below 10k ("$4,860"), compact above ("$18.4K"); other currencies after a "+". */
function money(totals: CurrencyAmount[]) {
  if (!totals.length) return { main: "—", more: null as string | null };
  const [first, ...rest] = totals;
  return { main: wholeMoney(first.amount, first.currency), more: rest.length ? `+ ${formatTotals(rest, { compact: true })}` : null };
}

function wholeMoney(minor: number, currency: string) {
  const value = minor / minorUnits(currency);
  if (Math.abs(value) >= 100_000) return formatMoney(minor, currency, { compact: true });
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase(), maximumFractionDigits: 0 }).format(value);
  } catch {
    return formatMoney(minor, currency);
  }
}

const SPEND_COLORS = ["#ff5fd7", "#3df5a0", "#3fd0ff", "#a98bff", "#ffd84d", "#2ef2d0", "#c6f432"];

export default async function Overview({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const { denied } = await searchParams;
  const s = await getDashboard();
  const can = (x: Parameters<typeof canSee>[1]) => canSee(s.user, x);
  // A source counts when it's connected, or when sample data is on (then it says so).
  const shown = (mode: SourceMode) => mode !== "demo" || samplesEnabled();
  const pill = (mode: SourceMode) => (mode !== "live" ? <ModePill mode={mode} /> : null);
  const nowMs = Date.now();

  const critical = s.openTasks.filter((t) => t.severity === "critical").length;
  const high = s.openTasks.filter((t) => t.severity === "high").length;
  const now = today();
  const tz = businessTimeZone();

  const samples = { samples: s.modes.stripe !== "live" };
  const m = moneyOverview(s.stripe, s.records, now, samples);
  const daily = dailyRevenue(s.stripe, now, samples);
  const focusable = await knownBusinesses().catch(() => [] as string[]);
  const businesses = [...new Set([...[...s.repos, ...s.hosting, ...s.databases, ...s.websites, ...s.openTasks].map((x) => x.business ?? "Unassigned"), ...m.spend.map((l) => l.business ?? "Unassigned"), ...s.stripe.map((a) => a.business)])].sort();
  const ring = businessRing(businesses, s.openTasks);

  // Systems row: only panels whose source this person may see and that is connected (or sampled).
  const showWeb = can("websites") && s.websites.length > 0 && shown(s.modes.websites);
  const showCams = can("cameras") && s.cameras.some((c) => c.channels.length > 0) && shown(s.modes.cameras);
  const showSolar = can("solar") && s.solar.length > 0 && shown(s.modes.solar);
  const history = new Map<string, UptimePoint[]>();
  if (showWeb && !s.dbError) {
    for (const h of await snapshotHistory<Omit<UptimePoint, "takenAt">>("website", 24).catch(() => [])) history.set(h.key, [...(history.get(h.key) ?? []), { ...h.data, takenAt: h.takenAt }]);
  }
  const systems = [showWeb, showCams, showSolar].filter(Boolean).length;
  const channels = s.cameras.flatMap((c) => c.channels);
  const camsOnline = channels.filter((c) => c.online).length;
  const sitesUp = s.websites.filter((w) => w.status === "up").length;

  // Secondary signals, kept from the earlier overview.
  const upcoming = can("agenda") ? todaysEvents(s.calendar, tz) : [];
  const unread = s.emails.filter((e) => e.unread).length;
  const failing = s.hosting.filter((h) => h.lastDeployState === "error").length;
  const users = s.websites.reduce((n, w) => n + (w.totalUsers ?? 0), 0);
  const newUsers = s.websites.reduce((n, w) => n + (w.newUsers7d ?? 0), 0);
  const visitors7d = s.websites.reduce((n, w) => n + (w.visitors7d ?? 0), 0);
  const openDeals = s.records.deals.filter((x) => OPEN_STAGES.includes(x.stage));
  const pipeline = sumByCurrency(openDeals.filter((x) => x.valueMinor != null).map((x) => ({ currency: x.currency, amount: x.valueMinor! })));
  const followUps = openDeals.filter((x) => x.nextStepDue && x.nextStepDue <= now).length;
  const rated = s.reviews.filter((p) => p.rating != null && p.reviewCount > 0);
  const rating = rated.length ? rated.reduce((n, p) => n + p.rating! * p.reviewCount, 0) / rated.reduce((n, p) => n + p.reviewCount, 0) : null;

  // Treasury
  const revenue = money(m.gross30d);
  const mrr = money(m.mrr);
  const balance = money(m.available);
  // The same monthly total as Platform spend: manual entries plus billing APIs, without double counting.
  const platformSpend = combinedSpend(s, now);
  const spendTotal = money(platformSpend.monthly);
  const spendCurrency = platformSpend.monthly[0]?.currency;
  const spendLines = topLines(platformSpend.lines.filter((l) => l.currency === spendCurrency).map((l) => ({ vendor: l.vendor, amount: l.monthly })), 5);
  const manualCount = platformSpend.lines.filter((l) => l.source === "manual").length;
  const apiCount = new Set(platformSpend.resolution.included.map((sl) => sl.vendor)).size;
  const spendAll = spendLines.top.reduce((n, l) => n + l.amount, 0) + spendLines.restAmount;
  const oldest = Math.max(0, ...m.receivables.map((r) => r.daysLate ?? 0));
  const activeSubs = s.stripe.filter((a) => (a.livemode && !a.sample) || (samples.samples && a.sample)).reduce((n, a) => n + a.activeSubscriptions, 0);

  return (
    <>
      <h1 className="sr-only">Overview</h1>
      {denied && <p className="hud-cut mb-4 border border-high/40 bg-high/10 px-4 py-2 text-sm">That page isn&apos;t part of your role. Ask an owner if you need it.</p>}

      <div className="grid gap-4 lg:grid-cols-[minmax(320px,400px)_minmax(0,1fr)] lg:gap-[22px]">
        <Card title="System core" action={`${businesses.length} business${businesses.length === 1 ? "" : "es"}`} accent="cyan" flush>
          <div className="grid place-items-center px-6 pb-3 pt-5">
            {businesses.length ? (
              <ReactorDial segments={ring} attention={critical + high} critical={critical} focused={s.business ?? null} focusable={focusable} />
            ) : (
              <Empty>No businesses yet.</Empty>
            )}
          </div>
          <div className="pb-4"><ReactorLegend /></div>
        </Card>

        <Card title="Priority queue" accent="pink" flush action={<Link href="/tasks" className="hover:text-ink">{s.openTasks.length} open · all →</Link>}>
          {s.openTasks.length === 0 ? (
            <Empty>Nothing needs you right now.</Empty>
          ) : (
            <ul>{s.openTasks.slice(0, 5).map((t) => <QueueRow key={t.id} task={t} />)}</ul>
          )}
        </Card>
      </div>

      {systems > 0 && (
        <div className={`mt-4 grid gap-4 lg:mt-[22px] lg:gap-[22px] ${systems === 3 ? "lg:grid-cols-[1.2fr_1fr_1fr]" : systems === 2 ? "lg:grid-cols-2" : ""}`}>
          {showWeb && (
            <Card title={<span className="flex items-center gap-2">Web perimeter {pill(s.modes.websites)}</span>} accent="teal" flush action={<Link href="/websites" className="hover:text-ink">{sitesUp}/{s.websites.length} online · 24 h</Link>}>
              <div className="py-2.5">
                {s.websites.slice(0, 6).map((w) => <UptimeRow key={w.id} site={w} points={history.get(w.domain) ?? []} now={nowMs} />)}
                {s.websites.length > 6 && <Link href="/websites" className="hud-label block px-5 pt-1 text-[11px] text-teal">+{s.websites.length - 6} more sites →</Link>}
              </div>
            </Card>
          )}
          {showCams && (
            <Card title={<span className="flex items-center gap-2">Surveillance{s.cameras.length === 1 ? ` · ${s.cameras[0].label}` : ""} {pill(s.modes.cameras)}</span>} accent="violet" flush action={<Link href="/cameras" className="hover:text-ink">{camsOnline}/{channels.length} online</Link>}>
              <CameraTiles sites={s.cameras} />
            </Card>
          )}
          {showSolar && (
            <Card
              title={<span className="flex items-center gap-2">Solar{s.solar.length === 1 ? "" : ` · ${s.solar[0].station}`} {pill(s.modes.solar)}</span>}
              accent="lime"
              flush
              action={<Link href="/solar" className="hover:text-ink">{s.solar[0].latest.status} · {timeAgo(s.solar[0].latest.at)}</Link>}
            >
              <SolarSummary station={s.solar[0]} lowBatteryPct={s.solarConfig.lowBatteryPct} />
            </Card>
          )}
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:mt-[22px] lg:grid-cols-3 lg:gap-[22px]">
        {can("agenda") && (
          <Card title="Coming up today" accent="cyan" flush action={<Link href="/agenda" className="hover:text-ink">Agenda →</Link>}>
            {upcoming.length === 0 ? <Empty>No more meetings today.</Empty> : (
              <ul className="py-1.5">
                {upcoming.slice(0, 5).map((e) => (
                  <li key={e.id} className="flex items-baseline gap-3 px-4 py-2 sm:px-5">
                    <span className="w-16 shrink-0 font-mono text-xs tabular-nums text-muted">{e.allDay ? "All day" : new Date(e.start).toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" })}</span>
                    <span className="min-w-0 flex-1 truncate text-sm">{e.meetingUrl ? <a href={e.meetingUrl} target="_blank" rel="noreferrer" className="hover:text-cyan">{e.title}</a> : e.title}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}

        <Card title="Latest alerts" accent="violet" flush action={can("notifications") ? <Link href="/notifications" className="hover:text-ink">All →</Link> : null}>
          {s.notifications.length === 0 ? <Empty>All quiet.</Empty> : (
            <ul className="py-1.5">
              {s.notifications.slice(0, 5).map((n) => (
                <li key={n.id} className="flex items-start gap-3 px-4 py-2 sm:px-5">
                  <SeverityBadge severity={n.severity} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">{n.url ? <a href={n.url} target="_blank" rel="noreferrer" className="hover:text-cyan">{n.title}</a> : n.title}</div>
                    <div className="truncate text-xs text-muted">{n.source} · {timeAgo(n.at)}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Signals" accent="emerald" flush>
          <div className="px-4 py-2.5 sm:px-5">
            {can("inbox") && <Link href="/inbox" className="block hover:text-ink"><KV k="Unread email" v={unread} /></Link>}
            {can("hosting") && <Link href="/hosting" className="block"><KV k="Failed deploys" v={<span className={failing ? "text-critical" : ""}>{failing ? `${failing} failing` : "0"}</span>} /></Link>}
            {can("websites") && <Link href="/websites" className="block"><KV k="Registered users" v={`${users.toLocaleString()} (+${newUsers} 7d)`} /></Link>}
            {can("analytics") && <Link href="/analytics" className="block"><KV k="Visitors (7 days)" v={s.modes.analytics === "live" || samplesEnabled() ? visitors7d.toLocaleString() : "not connected"} /></Link>}
            {can("clients") && <Link href="/clients" className="block"><KV k={`Open pipeline · ${openDeals.length} deal${openDeals.length === 1 ? "" : "s"}`} v={formatTotals(pipeline.slice(0, 1), { compact: true })} /></Link>}
            {can("clients") && <Link href="/clients" className="block"><KV k="Follow-ups due" v={<span className={followUps ? "text-high" : ""}>{followUps ? `${followUps} due` : "0"}</span>} /></Link>}
            {can("analytics") && <Link href="/analytics#reviews" className="block"><KV k="Google rating" v={rating ? `${rating.toFixed(1)} ★` : "—"} /></Link>}
            {!can("inbox") && !can("hosting") && !can("websites") && !can("analytics") && !can("clients") && <Empty>No other signals for your role.</Empty>}
          </div>
        </Card>
      </div>

      {can("money") && (
        <section className="hud-panel mt-4 lg:mt-[22px]" style={{ "--a": "#ffd84d" } as CSSProperties}>
          <header className="hud-head flex flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-5">
            <h2 className="hud-title flex items-center gap-2 text-[13px]">Treasury {pill(s.modes.stripe)}</h2>
            <Link href="/money" className="hud-label text-[11px] tracking-[0.12em] text-muted hover:text-ink">Stripe · {s.business ?? "all businesses"} →</Link>
          </header>
          <div className="grid grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_1.35fr_1fr]">
            <MoneyCell label="Revenue · 30 d" value={revenue.main} c1="#3df5a0" c2="#2ef2d0" href="/money" className="border-r">
              <div className="text-xs text-muted">{revenue.more ?? "gross, all accounts"}</div>
              <Sparkline values={daily.days.map((d) => d.amount)} />
            </MoneyCell>
            <MoneyCell label="MRR" value={mrr.main} c1="#3fd0ff" c2="#a98bff" href="/money">
              <div className="text-xs text-muted">{mrr.more ?? `${activeSubs} active subscription${activeSubs === 1 ? "" : "s"}`}</div>
            </MoneyCell>
            <MoneyCell label="Balance" value={balance.main} c1="#ffd84d" c2="#ff9f6b" href="/money" className="col-span-2 xl:col-span-1">
              <div className="text-xs text-muted">{balance.more ?? "available in Stripe"}</div>
            </MoneyCell>
            <MoneyCell label="Platform spend" value={<>{spendTotal.main}{platformSpend.monthly.length > 0 && <small className="text-sm">/mo</small>}</>} c1="#ff5fd7" c2="#a98bff" href="/spend" className="col-span-2 xl:col-span-1">
              <div className="text-xs text-muted">{spendTotal.more ? `${spendTotal.more} · ` : ""}{manualCount} active subscription{manualCount === 1 ? "" : "s"}{apiCount ? ` + ${apiCount} billing API${apiCount === 1 ? "" : "s"}` : ""}</div>
              {spendAll > 0 && (
                <>
                  <div className="mt-3 flex h-2.5 gap-[2px]" role="img" aria-label="Monthly spend by platform">
                    {spendLines.top.map((l, i) => <i key={`${l.vendor}-${i}`} style={{ flex: l.amount, background: SPEND_COLORS[i % SPEND_COLORS.length] }} />)}
                    {spendLines.restAmount > 0 && <i style={{ flex: spendLines.restAmount, background: "#5e7a8f" }} />}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-[#c5d3de]">
                    {spendLines.top.map((l, i) => (
                      <span key={`${l.vendor}-${i}`} className="inline-flex items-center gap-1.5"><i className="h-[7px] w-[7px]" style={{ background: SPEND_COLORS[i % SPEND_COLORS.length] }} />{l.vendor} <span className="tabular-nums">{wholeMoney(l.amount, spendCurrency!)}</span></span>
                    ))}
                    {spendLines.rest > 0 && <span className="text-muted">+{spendLines.rest} more</span>}
                  </div>
                </>
              )}
            </MoneyCell>
            <MoneyCell label="Overdue invoices" value={m.overdueCount} c1={m.overdueCount ? "#ff9f1c" : "#3df5a0"} c2={m.overdueCount ? "#ff3d6e" : "#2ef2d0"} href="/money" className="col-span-2 border-b-0 xl:col-span-1">
              <div className="text-xs text-muted">{m.overdueCount ? `${formatTotals(m.overdue, { compact: true })} · oldest ${oldest} day${oldest === 1 ? "" : "s"}` : "all paid on time"}</div>
            </MoneyCell>
          </div>
        </section>
      )}
    </>
  );
}
