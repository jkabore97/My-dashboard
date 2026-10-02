import Link from "next/link";
import { requireSection } from "@/lib/server/auth";
import { emailEnabled } from "@/lib/server/notify";
import { briefHour, knownBusinesses, weeklyReport } from "@/lib/server/reports";
import { getDashboard } from "@/lib/server/dashboard";
import { getSetting } from "@/lib/server/store/settings";
import { addDays, businessTimeZone, formatDate, isDate, today } from "@/lib/dates";
import { formatMoney, formatTotals } from "@/lib/money";
import { liveAccounts } from "@/lib/money-summary";
import { inBusiness, isFullOwner } from "@/lib/access";
import { Card, Empty, PageHeader, businessColor } from "@/components/ui";
import { ReportButtons } from "@/components/ReportButtons";
import { KV, Meter, Metrics } from "@/components/treasury/ui";
import { act } from "@/components/treasury/styles";

const short = (date: string) => formatDate(date).replace(/, \d{4}$/, "");
const weekday = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short" });

/** Most recent day (within a week) the morning brief was marked sent. */
async function lastBriefSent(day: string): Promise<string | null> {
  for (let i = 0; i < 7; i++) {
    const d = addDays(day, -i);
    const at = await getSetting<string | null>(`job:brief:${d}:done`, null).catch(() => null);
    if (at) return at;
  }
  return null;
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ business?: string; to?: string }> }) {
  const user = await requireSection("reports");
  const sp = await searchParams;
  const businesses = (await knownBusinesses()).filter((b) => inBusiness(user, b));
  const business = sp.business && businesses.includes(sp.business) ? sp.business : businesses[0];
  const now = today();
  const latest = addDays(now, -1);
  const to = sp.to && isDate(sp.to) && sp.to <= latest ? sp.to : latest;
  const r = business ? await weeklyReport(business, to) : null;
  const href = (b: string, t = to) => `/reports?business=${encodeURIComponent(b)}&to=${t}`;
  const change = r && r.revenue.length === 1 && r.revenuePrev.length === 1 && r.revenue[0].currency === r.revenuePrev[0].currency && r.revenuePrev[0].amount > 0 ? Math.round(((r.revenue[0].amount - r.revenuePrev[0].amount) / r.revenuePrev[0].amount) * 100) : null;
  const email = emailEnabled();

  // Daily revenue for the week, only from Stripe accounts whose money is real (as the report itself).
  const d = await getDashboard();
  const stripeLive = d.modes.stripe === "live";
  const live = stripeLive ? liveAccounts(d.stripe) : [];
  const days = r ? Array.from({ length: 7 }, (_, i) => addDays(r.from, i)) : [];
  const cur = r?.revenue[0]?.currency ?? "usd";
  const byDay = days.map((day) => ({ day, amount: live.filter((a) => a.business === r?.business).reduce((n, a) => n + a.daily.filter((x) => x.date === day && x.currency === cur).reduce((m, x) => m + x.gross, 0), 0) }));
  const dayMax = Math.max(1, ...byDay.map((x) => x.amount));
  const weekRevenue = r
    ? businesses
        .map((b) => ({ b, amount: live.filter((a) => a.business === b).reduce((n, a) => n + a.daily.filter((x) => x.date >= r.from && x.date <= r.to && x.currency === cur).reduce((m, x) => m + x.gross, 0), 0) }))
        .filter((x) => x.amount > 0)
        .sort((a, b) => b.amount - a.amount)
    : [];
  const weekMax = Math.max(1, ...weekRevenue.map((x) => x.amount));
  const briefAt = isFullOwner(user) ? await lastBriefSent(now) : null;
  const hour = briefHour();
  const tz = businessTimeZone();

  return (
    <>
      <PageHeader title="Weekly report" subtitle={`One page per business: revenue, users, uptime, issues closed and deals won. ${email ? `Emailed every Monday at ${hour}:00, with the morning brief daily.` : "Set RESEND_API_KEY, BRIEF_EMAIL_FROM and BRIEF_EMAIL_TO to get it by email."}`} />
      {!business || !r ? (
        <Card><Empty>Add your businesses (Settings → Business rules or Websites) to build reports.</Empty></Card>
      ) : (
        <>
          <div className="mb-5 flex flex-wrap items-center gap-2 print:hidden">
            {businesses.map((b) => {
              const on = b === business;
              const c = businessColor(b);
              return (
                <Link key={b} href={href(b)} aria-current={on ? "page" : undefined} className={`inline-flex min-h-10 items-center gap-2 border px-3 text-[13px] sm:min-h-9 ${on ? "border-[#ffd84d] bg-[#ffd84d]/10 text-[#eaf7ff] shadow-[0_0_12px_rgb(255_216_77/0.2)]" : "border-line text-muted hover:text-ink"}`}>
                  <span aria-hidden className="h-1.5 w-1.5" style={{ background: c, boxShadow: `0 0 6px ${c}` }} />{b}
                </Link>
              );
            })}
            <div className="flex items-center gap-2 max-sm:w-full max-sm:justify-between sm:ml-auto">
              <Link href={href(business, addDays(to, -7))} className={act}>← <span className="max-sm:hidden">Previous week</span><span className="sm:hidden">Prev</span></Link>
              <span className="whitespace-nowrap px-1 font-mono text-xs tabular-nums sm:px-2 sm:text-[13px]">{short(r.from)} – {short(r.to)}</span>
              {to < latest ? <Link href={href(business, addDays(to, 7) > latest ? latest : addDays(to, 7))} className={act}><span className="max-sm:hidden">Next week</span><span className="sm:hidden">Next</span> →</Link> : <span className={`${act} pointer-events-none opacity-40`} aria-disabled><span className="max-sm:hidden">Next week</span><span className="sm:hidden">Next</span> →</span>}
            </div>
          </div>

          <Card flush accent="cyan">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line/70 px-4 py-5 sm:px-6">
              <div>
                <h2 className="bg-gradient-to-r from-cyan to-[#eaf7ff] bg-clip-text font-display text-xl font-semibold tracking-[0.05em] text-transparent sm:text-2xl">{r.business}</h2>
                <p className="mt-1 text-sm text-muted">{formatDate(r.from)} – {formatDate(r.to)}</p>
              </div>
              <ReportButtons business={r.business} to={r.to} email={email} brief={isFullOwner(user)} />
            </div>
            <Metrics
              items={[
                { label: "Revenue", value: r.revenue.length ? formatTotals(r.revenue) : "—", tone: "emerald", hint: change !== null ? <><span className={change >= 0 ? "text-emerald" : "text-muted"}>{change >= 0 ? "▲" : "▼"} {Math.abs(change)}%</span> vs previous week ({formatTotals(r.revenuePrev)})</> : r.revenuePrev.length ? `Previous: ${formatTotals(r.revenuePrev)}` : stripeLive ? "no charges this week" : "connect Stripe to report revenue" },
                { label: "New users", value: r.newUsers ?? "—", tone: "cyan", hint: r.newUsers === null ? "needs site user counts" : "from site user counts" },
                { label: "Issues closed", value: r.tasksClosed, tone: "violet", hint: "last 7 days" },
                { label: "Still open", value: `${r.openCritical} / ${r.openHigh}`, tone: r.openCritical ? "critical" : r.openHigh ? "high" : "ink", hint: "critical / high" },
              ]}
            />
            <div className="grid lg:grid-cols-[1.2fr_1fr_1fr]">
              <div className="border-b border-line/70 px-4 py-5 sm:px-6 lg:border-b-0 lg:border-r">
                <h3 className="hud-label mb-3 text-xs text-emerald">Revenue by day</h3>
                {!stripeLive || !r.revenue.length ? <p className="text-sm text-muted">{stripeLive ? "No charges this week." : "Shown once Stripe is connected."}</p> : (
                  <div className="grid h-40 grid-cols-7 items-end gap-1.5 sm:gap-2" role="img" aria-label={`Revenue by day: ${byDay.map((x) => `${weekday(x.day)} ${formatMoney(x.amount, cur)}`).join(", ")}`}>
                    {byDay.map((x) => (
                      <div key={x.day} className="flex h-full min-w-0 flex-col items-center justify-end gap-1">
                        <em className="truncate font-mono text-[9px] not-italic tabular-nums text-[#bfe9d6] sm:text-[10px]">{x.amount ? formatMoney(x.amount, cur).replace(/\.00$/, "") : ""}</em>
                        <i className="block w-full" style={{ height: `${(x.amount / dayMax) * 72}%`, background: "linear-gradient(180deg, #3df5a0, rgb(46 242 208 / 0.15))", boxShadow: "0 0 10px rgb(61 245 160 / 0.25)" }} />
                        <span className="hud-label text-[10px] text-muted">{weekday(x.day)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="border-b border-line/70 px-4 py-5 sm:px-6 lg:border-b-0 lg:border-r">
                <h3 className="hud-label mb-3 text-xs text-teal">Uptime</h3>
                {r.sites.length ? (
                  <ul>
                    {r.sites.map((s) => {
                      const low = s.uptimePct !== null && s.uptimePct < 99;
                      return (
                        <li key={s.domain} className="grid grid-cols-[minmax(0,1fr)_64px_60px] items-center gap-2.5 border-b border-dashed border-line/70 py-2 text-[13px] last:border-0">
                          <span className="truncate">{s.domain}</span>
                          {s.uptimePct === null ? <span /> : <Meter pct={s.uptimePct} color={low ? "#ff9f1c" : "#2ef2d0"} />}
                          <span className={`text-right font-mono tabular-nums ${low ? "text-high" : ""}`}>{s.uptimePct === null ? "no checks" : `${s.uptimePct}%`}</span>
                        </li>
                      );
                    })}
                  </ul>
                ) : <p className="text-sm text-muted">No sites for this business.</p>}
              </div>
              <div className="px-4 py-5 sm:px-6">
                <h3 className="hud-label mb-3 text-xs text-gold">Deals won</h3>
                {r.dealsWon.length ? (
                  <ul>{r.dealsWon.map((x, i) => <li key={i} className="flex justify-between gap-3 border-b border-dashed border-line/70 py-2 text-[13px] last:border-0"><span className="min-w-0">{x.title}{x.client ? ` · ${x.client}` : ""}</span><span className="shrink-0 font-mono tabular-nums">{x.value ? formatTotals([x.value]) : ""}</span></li>)}</ul>
                ) : <p className="text-sm text-muted">None this week.</p>}
                {r.solarKWh !== null && (
                  <div className="mt-4 flex items-center gap-3.5 border border-lime/35 bg-lime/[0.06] px-3.5 py-3">
                    <b className="whitespace-nowrap font-display text-xl text-lime">{r.solarKWh} kWh</b>
                    <span className="text-sm text-muted">Solar produced this week</span>
                  </div>
                )}
              </div>
            </div>
          </Card>

          <div className="mt-5 grid items-start gap-5 lg:grid-cols-2 print:hidden">
            <Card title="Delivery" action={email ? "email · on" : "email · off"}>
              <KV k="Weekly report">{email ? `Mondays ${hour}:00 · ${businesses.length} business${businesses.length === 1 ? "" : "es"}` : "not emailed (email isn't set up)"}</KV>
              <KV k="Morning brief">{email ? `Daily ${hour}:00` : "not emailed"}</KV>
              <KV k="Time zone">{tz}</KV>
              {isFullOwner(user) && <KV k="Last brief sent">{briefAt ? new Date(briefAt).toLocaleString("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "not in the last 7 days"}</KV>}
            </Card>
            <Card flush accent="violet" title="All businesses · this week" action={`revenue · ${cur.toUpperCase()}`}>
              <div className="p-4 sm:p-5">
                {!stripeLive ? <p className="text-sm text-muted">Shown once Stripe is connected.</p> : weekRevenue.length === 0 ? <p className="text-sm text-muted">No {cur.toUpperCase()} charges this week.</p> : weekRevenue.map((x) => (
                  <Link key={x.b} href={href(x.b)} className="grid min-h-9 grid-cols-[minmax(0,120px)_1fr_auto] items-center gap-2.5 py-1 text-[13px] hover:text-cyan sm:grid-cols-[minmax(0,150px)_1fr_auto]">
                    <span className="flex min-w-0 items-center gap-1.5"><span aria-hidden className="h-1.5 w-1.5 shrink-0" style={{ background: businessColor(x.b) }} /><span className="truncate">{x.b}</span></span>
                    <Meter pct={(x.amount / weekMax) * 100} color={businessColor(x.b)} className="h-2" />
                    <span className="text-right font-mono tabular-nums">{formatMoney(x.amount, cur)}</span>
                  </Link>
                ))}
              </div>
            </Card>
          </div>
        </>
      )}
    </>
  );
}
