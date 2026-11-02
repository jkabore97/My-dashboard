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
import { Card, Empty, PageHeader, SYS, businessColor } from "@/components/ui";
import { ReportButtons } from "@/components/ReportButtons";
import { FilterRow, KV, Meter, Metrics } from "@/components/treasury/ui";
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
  const d = await getDashboard();
  // The business filter (top bar) narrows the choice to that one business.
  const businesses = (await knownBusinesses()).filter((b) => inBusiness(user, b) && (!d.business || b === d.business));
  const business = sp.business && businesses.includes(sp.business) ? sp.business : businesses[0];
  const now = today();
  const latest = addDays(now, -1);
  const to = sp.to && isDate(sp.to) && sp.to <= latest ? sp.to : latest;
  const r = business ? await weeklyReport(business, to) : null;
  const href = (b: string, t = to) => `/reports?business=${encodeURIComponent(b)}&to=${t}`;
  const change = r && r.revenue.length === 1 && r.revenuePrev.length === 1 && r.revenue[0].currency === r.revenuePrev[0].currency && r.revenuePrev[0].amount > 0 ? Math.round(((r.revenue[0].amount - r.revenuePrev[0].amount) / r.revenuePrev[0].amount) * 100) : null;
  const email = emailEnabled();

  // Daily revenue for the week, only from Stripe accounts whose money is real (as the report itself).
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
          <div className="mb-5 flex flex-wrap items-center gap-x-2 gap-y-3 print:hidden">
            <FilterRow>
              {businesses.map((b) => {
                const on = b === business;
                return (
                  <Link key={b} href={href(b)} aria-current={on ? "page" : undefined} className={`inline-flex min-h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-3.5 text-[14px] font-medium transition sm:min-h-9 ${on ? "bg-ink text-bg" : "bg-panel text-ink shadow-[0_0_0_1px_var(--color-line)] hover:bg-panel-2"}`}>
                    <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: businessColor(b) }} />{b}
                  </Link>
                );
              })}
            </FilterRow>
            <div className="flex items-center gap-2 max-sm:w-full max-sm:justify-between sm:ml-auto">
              <Link href={href(business, addDays(to, -7))} className={act}>‹ <span className="max-sm:hidden">Previous week</span><span className="sm:hidden">Prev</span></Link>
              <span className="whitespace-nowrap px-1 text-[13px] font-medium tabular-nums text-ink sm:px-2 sm:text-[15px]">{short(r.from)} – {short(r.to)}</span>
              {to < latest ? <Link href={href(business, addDays(to, 7) > latest ? latest : addDays(to, 7))} className={act}><span className="max-sm:hidden">Next week</span><span className="sm:hidden">Next</span> ›</Link> : <span className={`${act} pointer-events-none opacity-40`} aria-disabled><span className="max-sm:hidden">Next week</span><span className="sm:hidden">Next</span> ›</span>}
            </div>
          </div>

          <div className="mb-4 flex flex-wrap items-end justify-between gap-4 px-1">
            <div>
              <h2 className="text-[24px] font-bold tracking-[-0.01em] text-ink sm:text-[28px]">{r.business}</h2>
              <p className="mt-0.5 text-[15px] text-muted">{formatDate(r.from)} – {formatDate(r.to)}</p>
            </div>
            <ReportButtons business={r.business} to={r.to} email={email} brief={isFullOwner(user)} />
          </div>

          <Metrics
            items={[
              { label: "Revenue", value: r.revenue.length ? formatTotals(r.revenue) : "—", hint: change !== null ? <><span className={`font-medium ${change >= 0 ? "text-ok" : "text-warn"}`}>{change >= 0 ? "▲" : "▼"} {Math.abs(change)}%</span> vs previous week ({formatTotals(r.revenuePrev)})</> : r.revenuePrev.length ? `Previous: ${formatTotals(r.revenuePrev)}` : stripeLive ? "no charges this week" : "connect Stripe to report revenue" },
              { label: "New users", value: r.newUsers ?? "—", hint: r.newUsers === null ? "needs site user counts" : "from site user counts" },
              { label: "Issues closed", value: r.tasksClosed, hint: "last 7 days" },
              { label: "Still open", value: `${r.openCritical} / ${r.openHigh}`, tone: r.openCritical ? "critical" : r.openHigh ? "high" : "ink", hint: "critical / high" },
            ]}
          />

          <div className="mt-5 grid items-start gap-5 lg:grid-cols-[1.2fr_1fr_1fr]">
            <Card title="Revenue by day" flush={!stripeLive || !r.revenue.length}>
              {!stripeLive || !r.revenue.length ? <Empty>{stripeLive ? "No charges this week." : "Shown once Stripe is connected."}</Empty> : (
                <>
                  <div className="relative h-40" style={{ backgroundImage: "linear-gradient(var(--color-line) 1px, transparent 1px)", backgroundSize: "100% 25%" }}>
                    <div className="absolute inset-0 grid grid-cols-7 items-end gap-1.5 border-b border-line sm:gap-2" role="img" aria-label={`Revenue by day: ${byDay.map((x) => `${weekday(x.day)} ${formatMoney(x.amount, cur)}`).join(", ")}`}>
                      {byDay.map((x) => (
                        <div key={x.day} className="flex h-full min-w-0 flex-col items-center justify-end gap-1">
                          <em className="w-full truncate text-center text-[12px] font-medium not-italic tabular-nums text-ink">{x.amount ? formatMoney(x.amount, cur).replace(/\.00$/, "") : ""}</em>
                          <i className="block w-full rounded-t-[3px]" style={{ height: `${(x.amount / dayMax) * 72}%`, background: SYS.blue }} />
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="mt-1.5 grid grid-cols-7 gap-1.5 sm:gap-2">{byDay.map((x) => <span key={x.day} className="text-center text-[12px] text-muted">{weekday(x.day)}</span>)}</div>
                </>
              )}
            </Card>
            <Card flush title="Uptime">
              {r.sites.length ? (
                <ul>
                  {r.sites.map((s) => {
                    const low = s.uptimePct !== null && s.uptimePct < 99;
                    return (
                      <li key={s.domain} className="grid min-h-11 grid-cols-[minmax(0,1fr)_64px_72px] items-center gap-2.5 border-b border-line px-4 py-2 text-[15px] last:border-0 sm:px-5">
                        <span className="truncate text-ink">{s.domain}</span>
                        {s.uptimePct === null ? <span /> : <Meter pct={s.uptimePct} color={low ? SYS.orange : SYS.green} />}
                        <span className={`text-right tabular-nums ${low ? "font-semibold text-warn" : "text-muted"}`}>{s.uptimePct === null ? "no checks" : `${s.uptimePct}%`}</span>
                      </li>
                    );
                  })}
                </ul>
              ) : <Empty>No sites for this business.</Empty>}
            </Card>
            <Card flush title="Deals won">
              {r.dealsWon.length ? (
                <ul>{r.dealsWon.map((x, i) => <li key={i} className="flex min-h-11 items-center justify-between gap-3 border-b border-line px-4 py-2 text-[15px] last:border-0 sm:px-5"><span className="min-w-0 text-ink">{x.title}{x.client ? <span className="text-muted"> · {x.client}</span> : ""}</span><span className="shrink-0 font-semibold tabular-nums text-ink">{x.value ? formatTotals([x.value]) : ""}</span></li>)}</ul>
              ) : <Empty>None this week.</Empty>}
              {r.solarKWh !== null && (
                <div className="m-4 flex items-center gap-3.5 rounded-[12px] bg-panel-2 px-3.5 py-3 sm:m-5">
                  <b className="whitespace-nowrap text-[20px] font-bold tabular-nums text-ink">{r.solarKWh} kWh</b>
                  <span className="text-[13px] text-muted">Solar produced this week</span>
                </div>
              )}
            </Card>
          </div>

          <div className="mt-5 grid items-start gap-5 lg:grid-cols-2 print:hidden">
            <Card title="Delivery" action={email ? "Email on" : "Email off"}>
              <div className="-my-2.5">
                <KV k="Weekly report">{email ? `Mondays ${hour}:00 · ${businesses.length} business${businesses.length === 1 ? "" : "es"}` : "not emailed (email isn't set up)"}</KV>
                <KV k="Morning brief">{email ? `Daily ${hour}:00` : "not emailed"}</KV>
                <KV k="Time zone">{tz}</KV>
                {isFullOwner(user) && <KV k="Last brief sent">{briefAt ? new Date(briefAt).toLocaleString("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "not in the last 7 days"}</KV>}
              </div>
            </Card>
            <Card flush title="All businesses · this week" action={`revenue · ${cur.toUpperCase()}`}>
              <div className="p-4 sm:p-5">
                {!stripeLive ? <p className="text-[15px] text-muted">Shown once Stripe is connected.</p> : weekRevenue.length === 0 ? <p className="text-[15px] text-muted">No {cur.toUpperCase()} charges this week.</p> : weekRevenue.map((x) => (
                  <Link key={x.b} href={href(x.b)} className="grid min-h-10 grid-cols-[minmax(0,120px)_1fr_auto] items-center gap-2.5 rounded-lg py-1 text-[13px] text-ink hover:text-cyan sm:grid-cols-[minmax(0,150px)_1fr_auto]">
                    <span className="flex min-w-0 items-center gap-1.5"><span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: businessColor(x.b) }} /><span className="truncate">{x.b}</span></span>
                    <Meter pct={(x.amount / weekMax) * 100} color={businessColor(x.b)} className="h-2" />
                    <span className="text-right font-semibold tabular-nums">{formatMoney(x.amount, cur)}</span>
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
