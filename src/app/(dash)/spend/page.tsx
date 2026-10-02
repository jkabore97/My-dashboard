import { requireSection } from "@/lib/server/auth";
import { getDashboard } from "@/lib/server/dashboard";
import { daysBetween, formatDate, relativeDays, today } from "@/lib/dates";
import { formatMoney, formatTotals, toInputAmount } from "@/lib/money";
import { moneyOverview } from "@/lib/money-summary";
import { BizLabel, Card, Empty, PageHeader, Tag, businessColor } from "@/components/ui";
import { SubscriptionForm, SubscriptionRow } from "@/components/records";
import { AlertRow, FilterChip, Meter, Metrics, Monogram, StackBar } from "@/components/treasury/ui";
import { act, primary } from "@/components/treasury/styles";
import { monthlyOf, nextDate, recentChanges, renewalsWithin, spendByBusiness, spendProblems, spendShare, spendTotals, spendTrend } from "@/components/treasury/spend";

const FILTERS = { all: "All", month: "Monthly", year: "Yearly", free: "Free", stopped: "Stopped" } as const;
type Filter = keyof typeof FILTERS;

const short = (date: string) => formatDate(date).replace(/, \d{4}$/, "");
const monthName = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short" });

export default async function SpendPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  await requireSection("money");
  const sp = await searchParams;
  const show: Filter = sp.show && sp.show in FILTERS ? (sp.show as Filter) : "all";
  const d = await getDashboard();
  const now = today();
  const subs = d.records.subscriptions;
  const active = subs.filter((s) => s.active);
  const businesses = [...new Set([...d.stripe.map((a) => a.business), ...subs.map((s) => s.business), ...d.openTasks.map((t) => t.business)].filter(Boolean))].sort() as string[];

  const totals = spendTotals(subs);
  const cur = totals.monthly[0]?.currency ?? "usd";
  const main = totals.monthly[0]?.amount ?? 0;
  const renewals = renewalsWithin(subs, now, 30);
  const renewTotal = renewals.filter((r) => r.autoRenew && r.currency === cur).reduce((n, r) => n + r.amount, 0);
  const renewOther = [...new Set(renewals.filter((r) => r.currency !== cur).map((r) => r.currency.toUpperCase()))];
  const problems = spendProblems(subs, now);
  const problemIds = new Set(problems.map((p) => p.id));
  const perBusiness = spendByBusiness(subs);
  const maxBiz = Math.max(1, ...perBusiness.map((b) => b.totals.find((t) => t.currency === cur)?.amount ?? 0));
  const trend = spendTrend(subs, now, cur);
  const changes = recentChanges(subs, now, 30);
  // Spend vs revenue only when the revenue is real (never against sample Stripe data).
  const stripeLive = d.modes.stripe === "live";
  const share = stripeLive ? spendShare(totals.monthly, moneyOverview(d.stripe, d.records, now).gross30d) : null;

  const byCost = [...active].sort((a, b) => monthlyOf(b) - monthlyOf(a) || a.vendor.localeCompare(b.vendor));
  const list = (show === "stopped" ? subs.filter((s) => !s.active) : byCost).filter((s) => (show === "month" || show === "year" ? s.interval === show && s.amountMinor > 0 : show === "free" ? s.amountMinor === 0 : true));
  const listTotal = formatTotals(spendTotals(list.map((s) => ({ ...s, active: true }))).monthly);
  const stack = byCost.filter((s) => s.currency === cur && s.amountMinor > 0);
  const stackParts = [...stack.slice(0, 7).map((s) => ({ value: monthlyOf(s), color: businessColor(s.vendor), title: s.vendor })), { value: stack.slice(7).reduce((n, s) => n + monthlyOf(s), 0), color: "#5e7a8f", title: "Others" }];
  const trendMax = Math.max(1, ...trend.months.map((m) => m.amount));
  const withData = trend.months.filter((m) => m.amount > 0);
  const savedMonthly = formatTotals(spendTotals(changes.stopped.map((s) => ({ ...s, active: true }))).monthly);

  const grid = "grid grid-cols-[26px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 border-b border-line/50 px-4 py-3 sm:px-5 lg:grid-cols-[26px_minmax(0,1.5fr)_minmax(0,1fr)_68px_56px_84px_auto]";

  const chargedTo = (
    <Card flush title="Charged to" action="per business / mo">
          <div className="px-4 py-3 sm:px-5">
        {perBusiness.length === 0 ? <p className="text-sm text-muted">Nothing tracked yet.</p> : perBusiness.map((b) => {
          const amt = b.totals.find((t) => t.currency === cur)?.amount ?? 0;
          return (
            <div key={b.business} className="grid grid-cols-[minmax(0,120px)_1fr_auto] items-center gap-3 py-1.5 text-[13px] sm:grid-cols-[minmax(0,150px)_1fr_auto]">
              <BizLabel name={b.business} className="truncate" />
              <Meter pct={(amt / maxBiz) * 100} color={businessColor(b.business)} className="h-2" />
              <span className="text-right font-mono tabular-nums">{formatTotals(b.totals)}</span>
            </div>
          );
        })}
      </div>
    </Card>
  );

  return (
    <>
      <PageHeader title="Platform spend" subtitle="Every tool and service you pay for, what it costs each month, which business carries it, and what renews next. Currencies are never converted.">
        <a href="#add-subscription" className={primary}>+ Add subscription</a>
      </PageHeader>

      {problems.length > 0 && (
        <Card flush accent="pink" title="Needs attention" action={`${problems.length} ${problems.length === 1 ? "warning" : "warnings"}`} className="mb-5">
          {problems.map((p) => {
            const s = subs.find((x) => x.id === p.id)!;
            return (
              <AlertRow
                key={p.id}
                severity={p.severity}
                level={`${p.severity === "critical" ? "Critical · ended" : "High · ending"} · ${p.business ?? "Unassigned"}`}
                title={`${p.vendor} ${p.days < 0 ? "ended" : "ends"} ${short(p.date)} (${relativeDays(p.days)}): auto-renew is off`}
                meta={`${formatMoney(s.amountMinor, s.currency)}/${s.interval === "month" ? "mo" : "yr"}. Renew it, or stop tracking it if you're done with it.`}
                action={s.url ? <a href={s.url} target="_blank" rel="noreferrer" className={act}>Open billing</a> : <a href={`#sub-${p.id}`} className={act}>Review</a>}
              />
            );
          })}
        </Card>
      )}

      <Card flush title={`Spend overview · ${new Date(`${now}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "long" })}`} action={`${totals.count} subscription${totals.count === 1 ? "" : "s"} · ${cur.toUpperCase()}`}>
        <Metrics
          cols={5}
          items={[
            { label: "Monthly total", value: <>{formatMoney(main, cur)}<small className="text-sm">/mo</small></>, tone: "pink", hint: totals.monthly.length > 1 ? `+ ${formatTotals(totals.monthly.slice(1))}/mo` : "yearly plans spread over 12 months", extra: <StackBar parts={stackParts} label="Monthly cost by platform" /> },
            { label: "Yearly run-rate", value: formatMoney(totals.yearly[0]?.amount ?? 0, cur), tone: "gold", hint: totals.yearly.length > 1 ? `+ ${formatTotals(totals.yearly.slice(1))} · at today's prices` : "at today's prices" },
            { label: "Renewing · 30 days", value: formatMoney(renewTotal, cur), tone: "cyan", hint: renewals.length ? `${renewals.filter((r) => r.autoRenew).length} charge${renewals.filter((r) => r.autoRenew).length === 1 ? "" : "s"}, ${short(renewals[0].date)} – ${short(renewals[renewals.length - 1].date)}${renewOther.length ? ` · also ${renewOther.join(", ")}` : ""}` : "nothing renews in 30 days" },
            { label: "Paid platforms", value: <>{totals.paid}<small className="text-sm"> / {totals.count}</small></>, tone: "emerald", hint: totals.count - totals.paid ? `${totals.count - totals.paid} on a free tier` : "entered by hand" },
            { label: "% of revenue", value: share ? `${share.pct}%` : "—", tone: "lime", hint: share ? `${formatMoney(share.spend, share.currency)} of ${formatMoney(share.revenue, share.currency)} (30d)` : stripeLive ? `no ${cur.toUpperCase()} revenue in 30 days` : "needs live Stripe revenue" },
          ]}
        />
      </Card>

      <div className="mt-5 grid items-start gap-5 xl:grid-cols-[1.45fr_1fr]">
        <div className="grid min-w-0 gap-5">
        <Card flush accent="violet" title="6-month trend" action={`${cur.toUpperCase()} · at today's prices`}>
          {active.length === 0 ? <Empty>Add subscriptions to see how spend moves month to month.</Empty> : !trend.hasHistory ? (
            <Empty>Everything here was added this month, so there&apos;s no trend yet. It builds up from when each subscription is added or stopped.</Empty>
          ) : (
            <>
              <div className="grid h-64 grid-cols-6 items-end gap-2 px-4 pb-2 pt-5 sm:gap-4 sm:px-5" role="img" aria-label={`Monthly cost over the last 6 months: ${trend.months.map((m) => `${monthName(m.month)} ${formatMoney(m.amount, cur)}`).join(", ")}`}>
                {trend.months.map((m, i) => {
                  const last = i === trend.months.length - 1;
                  return (
                    <div key={m.month} className="flex h-full flex-col items-center justify-end gap-1.5">
                      <span className="font-mono text-[11px] tabular-nums text-ink sm:text-xs">{m.amount ? formatMoney(m.amount, cur).replace(/\.00$/, "") : "—"}</span>
                      <i className="block w-full max-w-16" style={{ height: `${(m.amount / trendMax) * 75}%`, background: "linear-gradient(180deg, #ff5fd7, rgb(169 139 255 / 0.35))", opacity: last ? 1 : 0.7, boxShadow: last ? "0 0 12px rgb(255 95 215 / 0.45)" : undefined }} />
                      <span className={`hud-label text-[11px] ${last ? "text-gold" : "text-muted"}`}>{monthName(m.month)}</span>
                    </div>
                  );
                })}
              </div>
              <p className="px-4 pb-3 text-xs text-muted sm:px-5">Approximate: each subscription counts from the month it was added until it stopped being tracked, at its current price. Price changes aren&apos;t recorded.</p>
              <div className="grid grid-cols-3 border-t border-line/70">
                <div className="border-r border-line/70 px-4 py-3 sm:px-5"><div className="hud-label text-[11px] text-muted">Average</div><div className="mt-1 font-mono text-base tabular-nums">{formatMoney(Math.round(withData.reduce((n, m) => n + m.amount, 0) / Math.max(1, withData.length)), cur)}</div></div>
                <div className="border-r border-line/70 px-4 py-3 sm:px-5"><div className="hud-label text-[11px] text-muted">Since {monthName(withData[0]?.month ?? trend.months[0].month)}</div><div className="mt-1 font-mono text-base tabular-nums">{(() => { const delta = trend.months[trend.months.length - 1].amount - (withData[0]?.amount ?? 0); return `${delta >= 0 ? "+" : "−"}${formatMoney(Math.abs(delta), cur)}`; })()}</div></div>
                <div className="px-4 py-3 sm:px-5"><div className="hud-label text-[11px] text-muted">Stopped · 30d</div><div className="mt-1 font-mono text-base tabular-nums text-emerald">{changes.stopped.length ? `${savedMonthly}/mo` : "—"}</div></div>
              </div>
            </>
          )}
        </Card>
        {!trend.hasHistory && chargedTo}
        </div>

        <div className="grid min-w-0 gap-5">
        <Card flush title="What changed · last 30 days" action={`${changes.added.length} added · ${changes.stopped.length} stopped`}>
          <div className="px-4 py-2 sm:px-5">
            {changes.added.length + changes.stopped.length === 0 ? <p className="py-3 text-sm text-muted">No subscriptions added or stopped in the last 30 days.</p> : (
              <>
                {changes.added.map((s) => <div key={s.id} className="flex justify-between gap-3 border-b border-dashed border-line/70 py-2 text-[13px]"><span className="min-w-0 truncate text-muted">{s.vendor} · new{s.business ? ` · ${s.business}` : ""}</span><b className="shrink-0 font-mono font-medium tabular-nums text-ink">+{formatMoney(monthlyOf(s), s.currency)}</b></div>)}
                {changes.stopped.map((s) => <div key={s.id} className="flex justify-between gap-3 border-b border-dashed border-line/70 py-2 text-[13px]"><span className="min-w-0 truncate text-muted">{s.vendor} · stopped{s.business ? ` · ${s.business}` : ""}</span><b className="shrink-0 font-mono font-medium tabular-nums text-emerald">−{formatMoney(monthlyOf(s), s.currency)}</b></div>)}
              </>
            )}
          </div>
        </Card>
        {trend.hasHistory && chargedTo}
        </div>
      </div>

      <div className="mt-5 grid items-start gap-5 xl:grid-cols-[1.45fr_1fr]">
        <Card flush accent="cyan" title="All platforms" action={`${list.length} · ${show === "stopped" ? "not tracked" : "sorted by monthly cost"}`}>
          <div className="flex flex-wrap gap-2 border-b border-line/70 px-4 py-3 sm:px-5">
            {(Object.keys(FILTERS) as Filter[]).map((f) => <FilterChip key={f} href={f === "all" ? "/spend" : `/spend?show=${f}`} on={show === f}>{FILTERS[f]}</FilterChip>)}
          </div>
          {list.length === 0 ? <Empty>{subs.length === 0 ? "Add the services you pay for (hosting, email, domains, design tools…) to see monthly cost per business and get renewal reminders." : "Nothing matches this filter."}</Empty> : (
            <div role="table" aria-label="Platforms">
              <div role="row" className="hidden grid-cols-[26px_minmax(0,1.6fr)_minmax(0,1.1fr)_80px_80px_96px_auto] gap-3 border-b border-line px-5 py-2.5 lg:grid">
                {["", "Platform", "Business", "Billing", "Renews", "/ mo", ""].map((h, i) => <span key={i} role="columnheader" className={`hud-label text-[11px] text-muted ${h === "/ mo" ? "text-right" : ""}`}>{h}</span>)}
              </div>
              {list.map((s) => {
                const next = s.active ? nextDate(s, now) : null;
                const days = next ? daysBetween(now, next) : null;
                const flag = problemIds.has(s.id);
                const free = s.amountMinor === 0;
                return (
                  <div key={s.id} id={`sub-${s.id}`} className={`scroll-mt-6 ${s.active ? "" : "opacity-60"}`}>
                    <SubscriptionRow
                      businesses={businesses}
                      className={grid}
                      actionsClassName="col-span-full flex justify-end lg:col-span-1"
                      compact
                      s={{ id: s.id, active: s.active, vendor: s.vendor, plan: s.plan, amount: toInputAmount(s.amountMinor, s.currency), currency: s.currency.toUpperCase(), interval: s.interval, nextRenewal: s.nextRenewal, autoRenew: s.autoRenew, business: s.business, url: s.url, notes: s.notes }}
                    >
                      <Monogram name={s.vendor} />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                          {s.url ? <a href={s.url} target="_blank" rel="noreferrer" className="hover:text-cyan">{s.vendor}</a> : s.vendor}
                          {flag && <Tag color={days !== null && days < 0 ? "#ff3d6e" : "#ff9f1c"}>{days !== null && days < 0 ? "Ended" : "Ends soon"}</Tag>}
                          {!s.active && <Tag>Not tracked</Tag>}
                        </div>
                        <div className="truncate text-xs text-muted">{[s.plan, free ? "Free tier" : null].filter(Boolean).join(" · ") || "—"}</div>
                        <div className="text-xs text-muted lg:hidden">
                          {s.business ?? "Unassigned"} · {free ? "free" : `${formatMoney(s.amountMinor, s.currency)}/${s.interval === "month" ? "mo" : "yr"}`}{next ? ` · ${s.autoRenew ? "renews" : "ends"} ${short(next)}` : ""}
                        </div>
                      </div>
                      <div className="hidden min-w-0 lg:block"><BizLabel name={s.business ?? "Unassigned"} className="max-w-full overflow-hidden whitespace-nowrap" /></div>
                      <span className="hidden text-sm lg:block">{free ? "Free" : s.interval === "month" ? "Monthly" : "Yearly"}</span>
                      <span className={`hidden font-mono text-sm tabular-nums lg:block ${flag ? (days! < 0 ? "text-critical" : "text-high") : ""}`}>{next ? short(next) : "—"}</span>
                      <span className={`text-right font-mono text-sm tabular-nums ${free ? "text-muted" : ""}`}>{formatMoney(monthlyOf(s), s.currency)}</span>
                    </SubscriptionRow>
                  </div>
                );
              })}
              {show !== "stopped" && (
                <div className="flex items-center justify-between px-4 py-3 sm:px-5">
                  <span className="hud-label text-xs text-gold">Total</span>
                  <span className="font-mono text-base tabular-nums text-gold">{listTotal}/mo</span>
                </div>
              )}
            </div>
          )}
        </Card>

        <Card flush accent="pink" title="Renewals · next 30 days" action={renewals.length ? formatMoney(renewTotal, cur) : undefined}>
          {renewals.length === 0 ? <Empty>Nothing renews in the next 30 days{active.some((s) => !s.nextRenewal) ? ". Add renewal dates to see them here" : ""}.</Empty> : (
            <ol className="px-4 py-1.5 sm:px-5">
              {renewals.map((r) => {
                const flag = !r.autoRenew;
                const dt = new Date(`${r.date}T00:00:00Z`);
                return (
                  <li key={`${r.id}-${r.date}`} className="grid grid-cols-[56px_minmax(0,1fr)] items-center gap-3.5 border-b border-dashed border-line/70 py-2.5 last:border-0 sm:grid-cols-[60px_minmax(0,1fr)_auto]">
                    <div className={`border py-1 text-center font-display text-[11px] font-semibold uppercase tracking-[0.06em] ${flag ? "border-high text-high" : "border-line text-[#9be7ff]"}`}>
                      {dt.toLocaleDateString("en-US", { timeZone: "UTC", month: "short" })}
                      <b className={`block text-lg leading-tight ${flag ? "text-high" : "text-[#eaf7ff]"}`}>{dt.getUTCDate()}</b>
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-sm">{r.vendor}{r.plan ? <span className="text-muted">{r.plan}</span> : null}{flag ? <Tag color="#ff9f1c">Ends · no auto-renew</Tag> : r.interval === "year" ? <Tag color="#3fd0ff">Yearly</Tag> : null}</div>
                      <div className="text-xs text-muted">{r.business ?? "Unassigned"} · <span className="font-mono tabular-nums">{formatMoney(r.amount, r.currency)}</span> · {relativeDays(r.days)}</div>
                    </div>
                    <span className="max-sm:hidden"><a href={`#sub-${r.id}`} className={act}>Details</a></span>
                  </li>
                );
              })}
            </ol>
          )}
        </Card>
      </div>

      <div id="add-subscription" className="scroll-mt-6">
        <Card className="mt-5" title="Add subscription" action="entered by hand">
          <SubscriptionForm businesses={businesses} inline />
        </Card>
      </div>
    </>
  );
}
