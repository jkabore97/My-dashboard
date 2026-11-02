import Link from "next/link";
import type { ReactNode } from "react";
import { combinedSpend } from "@/lib/billing/spend";
import { getDashboard, type TaskView } from "@/lib/server/dashboard";
import { Dot, Empty, Group, ModePill, Row, SectionTitle, SEVERITY_VAR, Stat, timeAgo } from "@/components/ui";
import { FixButton } from "@/components/FixButton";
import { addDays, businessTimeZone, today } from "@/lib/dates";
import { OPEN_STAGES } from "@/lib/server/store/pipeline";
import { formatMoney, formatTotals, minorUnits, sumByCurrency, type CurrencyAmount } from "@/lib/money";
import { moneyOverview } from "@/lib/money-summary";
import { canSee } from "@/lib/access";
import { samplesEnabled } from "@/lib/source";
import type { CalendarEvent, SourceMode } from "@/lib/types";

/** Whole units below 100k ("$4,860"), compact above ("$184K"); other currencies after a "+". */
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

function greeting(tz: string, now: Date) {
  const h = Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(now));
  return h < 5 ? "Good evening" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

/** First name from the person's display name; nothing for an address or the shared "owner" identity. */
function firstName(name: string, email: string) {
  const n = name.trim();
  if (!n || n === email || n.includes("@") || n.toLowerCase() === "owner") return null;
  return n.split(/\s+/)[0];
}

const eventStart = (e: CalendarEvent) => (e.allDay ? Date.parse(`${e.start.slice(0, 10)}T00:00:00Z`) : Date.parse(e.start));

/** "in 15 min", "Now", "Today", "Tomorrow", "Wed". */
function whenLabel(e: CalendarEvent, tz: string, now: Date, todayStr: string) {
  const day = e.allDay ? e.start.slice(0, 10) : today(tz, new Date(e.start));
  if (day === todayStr && !e.allDay) {
    const mins = Math.round((Date.parse(e.start) - now.getTime()) / 60_000);
    if (mins <= 0) return "Now";
    if (mins < 60) return `in ${mins} min`;
    return "Today";
  }
  if (day === todayStr) return "Today";
  if (day === addDays(todayStr, 1)) return "Tomorrow";
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

function eventTimes(e: CalendarEvent, tz: string) {
  if (e.allDay) return "All day";
  const f = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
  return `${f(e.start)} – ${f(e.end)}`;
}

/** The one button a "Needs you" row offers. */
function TaskAction({ t }: { t: TaskView }) {
  if (t.actionable && t.fix) return <FixButton taskId={t.id} label={t.fix} title={t.title} />;
  const external = !!t.url && /^https?:/.test(t.url);
  const href = t.url ?? `/tasks${t.business ? `?business=${encodeURIComponent(t.business)}` : ""}`;
  const word = t.severity === "critical" ? "Respond" : t.source.toLowerCase().startsWith("email") ? "Reply" : "Review";
  return (
    <Link href={href} target={external ? "_blank" : undefined} rel={external ? "noreferrer" : undefined}
      className="inline-flex min-h-9 items-center rounded-full bg-cyan px-3.5 text-[13px] font-semibold text-white transition hover:brightness-110 active:opacity-80 sm:min-h-8">
      {word}
    </Link>
  );
}

export default async function Today({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const { denied } = await searchParams;
  const s = await getDashboard();
  const can = (x: Parameters<typeof canSee>[1]) => canSee(s.user, x);
  // A source counts when it's connected, or when sample data is on (then it says so).
  const shown = (mode: SourceMode) => mode !== "demo" || samplesEnabled();
  const pill = (mode: SourceMode) => (mode !== "live" ? <ModePill mode={mode} /> : null);

  const nowDate = new Date();
  const now = today();
  const tz = businessTimeZone();
  const dateLine = nowDate.toLocaleDateString("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric" });
  const who = firstName(s.user.name, s.user.email);

  const samples = { samples: s.modes.stripe !== "live" };
  const m = moneyOverview(s.stripe, s.records, now, samples);
  const moneyOn = can("money") && shown(s.modes.stripe);

  // Key numbers: the first four that this person may see and that have data.
  const tiles: { key: string; node: ReactNode }[] = [];
  if (moneyOn && m.gross30d.length) {
    const r = money(m.gross30d);
    const mrr = money(m.mrr);
    tiles.push({ key: "rev", node: <Link href="/money" className="block"><Stat label="Revenue · 30 days" value={r.main} hint={r.more ?? (m.mrr.length ? `${mrr.main} MRR` : "gross, all accounts")} /></Link> });
  }
  if (moneyOn) {
    const owed = money(m.outstanding);
    tiles.push({ key: "owed", node: <Link href="/money" className="block"><Stat label="Unpaid invoices" value={m.outstanding.length ? owed.main : "$0"} hint={m.overdueCount ? `${m.overdueCount} overdue` : "All paid on time"} hintTone={m.overdueCount ? "high" : "ok"} /></Link> });
  }
  if (can("websites") && s.websites.length > 0 && shown(s.modes.websites)) {
    const up = s.websites.filter((w) => w.status === "up").length;
    const down = s.websites.filter((w) => w.status === "down").length;
    const degraded = s.websites.filter((w) => w.status === "degraded").length;
    tiles.push({ key: "web", node: <Link href="/websites" className="block"><Stat label="Websites" value={`${up} / ${s.websites.length}`} hint={down ? `${down} down` : degraded ? `${degraded} slow` : "All online"} hintTone={down ? "critical" : degraded ? "high" : "ok"} /></Link> });
  }
  if (can("solar") && s.solar.length > 0 && shown(s.modes.solar)) {
    const st = s.solar[0];
    const soc = st.latest.batterySoc;
    const low = soc !== null && soc < s.solarConfig.lowBatteryPct;
    tiles.push({ key: "solar", node: <Link href="/solar" className="block"><Stat label="Solar today" value={st.latest.todayKWh === null ? "—" : `${st.latest.todayKWh} kWh`} hint={soc === null ? st.station : `Battery ${Math.round(soc)}%${low ? " · low" : ""}`} hintTone={low ? "high" : undefined} /></Link> });
  }
  const platformSpend = combinedSpend(s, now);
  if (can("money") && platformSpend.monthly.length) {
    const sp = money(platformSpend.monthly);
    tiles.push({ key: "spend", node: <Link href="/spend" className="block"><Stat label="Platform spend" value={`${sp.main}/mo`} hint={sp.more ?? `${platformSpend.lines.length} subscription${platformSpend.lines.length === 1 ? "" : "s"}`} /></Link> });
  }
  const unread = s.emails.filter((e) => e.unread).length;
  if (can("inbox") && s.emails.length) tiles.push({ key: "mail", node: <Link href="/inbox" className="block"><Stat label="Unread email" value={unread} hint="last 14 days" /></Link> });
  const keyTiles = tiles.slice(0, 4);

  // Needs you: open tasks, most urgent first.
  const urgent = s.openTasks.filter((t) => t.severity === "critical" || t.severity === "high");
  const needs = (urgent.length >= 4 ? urgent : [...urgent, ...s.openTasks.filter((t) => t.severity !== "critical" && t.severity !== "high")]).slice(0, 6);

  // Up next: what's left of today, then the next days.
  const upcoming = can("agenda")
    ? s.calendar.filter((e) => (e.allDay ? e.start.slice(0, 10) >= now : Date.parse(e.end) > nowDate.getTime())).sort((a, b) => eventStart(a) - eventStart(b)).slice(0, 6)
    : [];

  // At a glance: the other numbers the old overview showed.
  const failing = s.hosting.filter((h) => h.lastDeployState === "error").length;
  const users = s.websites.reduce((n, w) => n + (w.totalUsers ?? 0), 0);
  const newUsers = s.websites.reduce((n, w) => n + (w.newUsers7d ?? 0), 0);
  const visitors7d = s.websites.reduce((n, w) => n + (w.visitors7d ?? 0), 0);
  const openDeals = s.records.deals.filter((x) => OPEN_STAGES.includes(x.stage));
  const pipeline = sumByCurrency(openDeals.filter((x) => x.valueMinor != null).map((x) => ({ currency: x.currency, amount: x.valueMinor! })));
  const followUps = openDeals.filter((x) => x.nextStepDue && x.nextStepDue <= now).length;
  const rated = s.reviews.filter((p) => p.rating != null && p.reviewCount > 0);
  const rating = rated.length ? rated.reduce((n, p) => n + p.rating! * p.reviewCount, 0) / rated.reduce((n, p) => n + p.reviewCount, 0) : null;
  const oldest = Math.max(0, ...m.receivables.map((r) => r.daysLate ?? 0));
  const channels = s.cameras.flatMap((c) => c.channels);
  const camsOffline = channels.filter((c) => c.online === false).length;

  const glance: ReactNode[] = [];
  if (moneyOn) {
    glance.push(<Row key="mrr" label="Monthly recurring revenue" value={money(m.mrr).main} href="/money" />);
    glance.push(<Row key="bal" label="Stripe balance" value={money(m.available).main} href="/money" />);
    if (m.overdueCount) glance.push(<Row key="od" label="Overdue invoices" sub={`${formatTotals(m.overdue, { compact: true })} · oldest ${oldest} day${oldest === 1 ? "" : "s"}`} value={<span className="text-warn">{m.overdueCount}</span>} href="/money" />);
  }
  if (can("clients")) {
    glance.push(<Row key="pipe" label="Open pipeline" sub={`${openDeals.length} deal${openDeals.length === 1 ? "" : "s"}`} value={pipeline.length ? formatTotals(pipeline.slice(0, 1), { compact: true }) : "—"} href="/clients" />);
    glance.push(<Row key="fu" label="Follow-ups due" value={followUps ? <span className="text-warn">{followUps}</span> : "None"} href="/clients" />);
  }
  if (can("hosting")) glance.push(<Row key="dep" label="Failed deploys" value={failing ? <span className="text-critical">{failing}</span> : "None"} href="/hosting" />);
  if (can("cameras") && channels.length && shown(s.modes.cameras)) glance.push(<Row key="cam" label="Cameras" value={camsOffline ? <span className="text-critical">{camsOffline} offline</span> : `${channels.length} online`} href="/cameras" />);
  if (can("websites")) glance.push(<Row key="users" label="Registered users" value={`${users.toLocaleString()} (+${newUsers} this week)`} href="/websites" />);
  if (can("analytics")) {
    glance.push(<Row key="vis" label="Visitors · 7 days" value={s.modes.analytics === "live" || samplesEnabled() ? visitors7d.toLocaleString() : "Not connected"} href="/analytics" />);
    glance.push(<Row key="rate" label="Google rating" value={rating ? `${rating.toFixed(1)} ★` : "—"} href="/analytics#reviews" />);
  }

  return (
    <>
      <div className="mb-5 sm:mb-6">
        <p className="text-[13px] font-medium text-muted sm:text-[14px]">{dateLine}</p>
        <h1 className="mt-0.5 text-[30px] font-bold leading-tight tracking-[-0.02em] sm:text-[34px]">{greeting(tz, nowDate)}{who ? `, ${who}` : ""}</h1>
      </div>

      {denied && <p className="mb-4 rounded-[14px] bg-high/12 px-4 py-3 text-[14px]">That page isn&apos;t part of your role. Ask an owner if you need it.</p>}

      {keyTiles.length > 0 && (
        <div className={`mb-7 grid grid-cols-2 gap-2.5 sm:gap-4 ${keyTiles.length >= 4 ? "lg:grid-cols-4" : keyTiles.length === 3 ? "lg:grid-cols-3" : ""}`}>
          {keyTiles.map((t) => <div key={t.key} className="min-w-0 [&_a]:transition-opacity [&_a:active]:opacity-70">{t.node}</div>)}
        </div>
      )}
      {(moneyOn && s.modes.stripe !== "live") && <p className="-mt-5 mb-6 flex items-center gap-2 px-1 text-[13px] text-muted">{pill(s.modes.stripe)} Money numbers are sample data until Stripe is connected.</p>}

      <div className="grid gap-7 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:gap-5">
        <div className="min-w-0">
          <SectionTitle action={s.openTasks.length > 0 && can("tasks") ? <Link href="/tasks">All {s.openTasks.length}</Link> : null}>Needs you</SectionTitle>
          <Group>
            {needs.length === 0 ? (
              <Empty><span className="text-ok">✓</span> Nothing needs you right now.</Empty>
            ) : (
              needs.map((t) => (
                <div key={t.id} className="flex items-center gap-3 px-4 py-3">
                  <Dot color={SEVERITY_VAR[t.severity]} />
                  <span className="sr-only">{t.severity}</span>
                  <div className="min-w-0 flex-1">
                    <div className="break-words text-[15px] font-medium leading-snug">{t.title}</div>
                    <div className="truncate text-[13px] text-muted">{[t.business, t.source, timeAgo(t.createdAt)].filter(Boolean).join(" · ")}</div>
                  </div>
                  <div className="shrink-0"><TaskAction t={t} /></div>
                </div>
              ))
            )}
          </Group>
        </div>

        <div className="grid min-w-0 content-start gap-7">
          {can("agenda") && (
            <div>
              <SectionTitle action={<Link href="/agenda">Calendar</Link>}>Up next</SectionTitle>
              <Group>
                {upcoming.length === 0 ? <Empty>Nothing on the calendar.</Empty> : upcoming.map((e) => {
                  const body = (
                    <>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[15px] font-medium">{e.title}</div>
                        <div className="truncate text-[13px] text-muted">{eventTimes(e, tz)}{e.location ? ` · ${e.location}` : ""}</div>
                      </div>
                      <span className="shrink-0 text-[13px] text-muted">{whenLabel(e, tz, nowDate, now)}</span>
                    </>
                  );
                  return e.meetingUrl
                    ? <a key={e.id} href={e.meetingUrl} target="_blank" rel="noreferrer" className="flex items-center gap-3 px-4 py-3 hover:bg-fill">{body}</a>
                    : <div key={e.id} className="flex items-center gap-3 px-4 py-3">{body}</div>;
                })}
              </Group>
            </div>
          )}

          <div>
            <SectionTitle action={can("notifications") ? <Link href="/notifications">All</Link> : null}>Recent alerts</SectionTitle>
            <Group>
              {s.notifications.length === 0 ? <Empty>All quiet.</Empty> : s.notifications.slice(0, 4).map((n) => {
                const body = (
                  <>
                    <Dot color={SEVERITY_VAR[n.severity]} />
                    <span className="sr-only">{n.severity}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[15px]">{n.title}</div>
                      <div className="truncate text-[13px] text-muted">{n.source} · {timeAgo(n.at)}</div>
                    </div>
                  </>
                );
                return n.url
                  ? <a key={n.id} href={n.url} target="_blank" rel="noreferrer" className="flex items-center gap-3 px-4 py-3 hover:bg-fill">{body}</a>
                  : <div key={n.id} className="flex items-center gap-3 px-4 py-3">{body}</div>;
              })}
            </Group>
          </div>

          {glance.length > 0 && (
            <div>
              <SectionTitle>At a glance</SectionTitle>
              <Group>{glance}</Group>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
