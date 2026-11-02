import { requireSection } from "@/lib/server/auth";
import { getDashboard } from "@/lib/server/dashboard";
import { daysBetween, formatDate, relativeDays, today } from "@/lib/dates";
import { formatMoney, formatTotals, toInputAmount } from "@/lib/money";
import type { SourceMode } from "@/lib/types";
import { moneyOverview } from "@/lib/money-summary";
import { BizLabel, Card, Empty, Group, PageHeader, SYS, Tag, businessColor } from "@/components/ui";
import { SubscriptionForm, SubscriptionRow } from "@/components/records";
import { AlertRow, FilterChip, FilterRow, Meter, Metrics, Monogram, StackBar, colHead } from "@/components/treasury/ui";
import { act, primary } from "@/components/treasury/styles";
import { AutomaticBills, BillCoverage, DetectedBills, showSource } from "@/components/treasury/AutoBills";
import { combinedSpend, emptyBills } from "@/lib/billing/spend";
import { billCoverage } from "@/lib/billing/coverage";
import { configStatus, PLATFORM_DEFS } from "@/lib/platforms";
import { env } from "@/lib/source";
import { isFullOwner } from "@/lib/access";
import { sumByCurrency } from "@/lib/money";
import { monthlyOf, nextDate, recentChanges, renewalsWithin, spendProblems, spendShare, spendTotals, spendTrend } from "@/components/treasury/spend";

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

  // Billing APIs join the total only where they don't double-count your own entries (see resolveSpend).
  const bills = d.bills ?? emptyBills();
  const owner = isFullOwner(d.user);
  const combined = combinedSpend(d, now);
  const counted = subs.filter((s) => !combined.resolution.excludedSubIds.has(s.id));
  const totals = spendTotals(counted);
  const apiMonthly = sumByCurrency(combined.resolution.included.map((sl) => ({ currency: sl.currency, amount: sl.amount })));
  const monthlyAll = combined.monthly;
  const yearlyAll = sumByCurrency([...totals.yearly, ...apiMonthly.map((a) => ({ currency: a.currency, amount: a.amount * 12 }))]);
  const cur = monthlyAll[0]?.currency ?? "usd";
  const main = monthlyAll[0]?.amount ?? 0;
  const renewals = renewalsWithin(subs, now, 30);
  const renewTotal = renewals.filter((r) => r.autoRenew && r.currency === cur).reduce((n, r) => n + r.amount, 0);
  const renewOther = [...new Set(renewals.filter((r) => r.currency !== cur).map((r) => r.currency.toUpperCase()))];
  const problems = spendProblems(subs, now);
  const problemIds = new Set(problems.map((p) => p.id));
  const perBusiness = [...new Set(combined.lines.map((l) => l.business ?? "Unassigned"))]
    .map((business) => ({ business, totals: sumByCurrency(combined.lines.filter((l) => (l.business ?? "Unassigned") === business).map((l) => ({ currency: l.currency, amount: l.monthly }))) }))
    .sort((a, b) => (b.totals[0]?.amount ?? 0) - (a.totals[0]?.amount ?? 0) || a.business.localeCompare(b.business));
  const maxBiz = Math.max(1, ...perBusiness.map((b) => b.totals.find((t) => t.currency === cur)?.amount ?? 0));
  const trend = spendTrend(subs, now, cur);
  const changes = recentChanges(subs, now, 30);
  // Spend vs revenue only when the revenue is real (never against sample Stripe data).
  const stripeLive = d.modes.stripe === "live";
  const share = stripeLive ? spendShare(monthlyAll, moneyOverview(d.stripe, d.records, now).gross30d) : null;

  const byCost = [...active].sort((a, b) => monthlyOf(b) - monthlyOf(a) || a.vendor.localeCompare(b.vendor));
  const list = (show === "stopped" ? subs.filter((s) => !s.active) : byCost).filter((s) => (show === "month" || show === "year" ? s.interval === show && s.amountMinor > 0 : show === "free" ? s.amountMinor === 0 : true));
  const listTotal = formatTotals(spendTotals(list.filter((s) => !combined.resolution.excludedSubIds.has(s.id)).map((s) => ({ ...s, active: true }))).monthly);
  const stack = combined.lines.filter((l) => l.currency === cur && l.monthly > 0).sort((a, b) => b.monthly - a.monthly);
  const stackParts = [...stack.slice(0, 7).map((l) => ({ value: l.monthly, color: businessColor(l.vendor), title: l.vendor })), { value: stack.slice(7).reduce((n, l) => n + l.monthly, 0), color: SYS.gray, title: "Others" }];
  // Every connected platform, for "Bill coverage" (owners only: it names setup problems).
  const connected = owner
    ? PLATFORM_DEFS.filter((p) => p.available).flatMap((p) => {
        if (p.configOnly) return configStatus(p, (k) => !!env(k)).on ? [{ id: p.id, mode: "live" as const }] : [];
        const mode = (d.platforms as { id: string; mode: SourceMode | null }[]).find((x) => x.id === p.id)?.mode ?? null;
        return mode === "live" || mode === "error" ? [{ id: p.id, mode }] : [];
      })
    : [];
  const coverage = owner ? billCoverage({ connected, bills, api: combined.api, subs }) : [];
  const sampleMail = d.modes.billmail !== "live";
  const trendMax = Math.max(1, ...trend.months.map((m) => m.amount));
  const withData = trend.months.filter((m) => m.amount > 0);
  const savedMonthly = formatTotals(spendTotals(changes.stopped.map((s) => ({ ...s, active: true }))).monthly);

  const grid = "grid grid-cols-[29px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 border-b border-line px-4 py-3 sm:px-5 lg:grid-cols-[29px_minmax(0,1.5fr)_minmax(0,1fr)_68px_56px_84px_auto]";

  const chargedTo = (
    <Card flush title="Charged to" action="per business / mo">
      <div className="px-4 py-3 sm:px-5">
        {perBusiness.length === 0 ? <p className="text-[15px] text-muted">Nothing tracked yet.</p> : perBusiness.map((b) => {
          const amt = b.totals.find((t) => t.currency === cur)?.amount ?? 0;
          return (
            <div key={b.business} className="grid min-h-9 grid-cols-[minmax(0,120px)_1fr_auto] items-center gap-3 py-1 text-[13px] sm:grid-cols-[minmax(0,150px)_1fr_auto]">
              <BizLabel name={b.business} className="truncate !text-ink" />
              <Meter pct={(amt / maxBiz) * 100} color={businessColor(b.business)} className="h-2" />
              <span className="text-right font-semibold tabular-nums text-ink">{formatTotals(b.totals)}</span>
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
        <Group className="mb-6" header={`Needs attention · ${problems.length} ${problems.length === 1 ? "warning" : "warnings"}`}>
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
        </Group>
      )}

      <Metrics
        cols={5}
        items={[
          { label: "Monthly total", value: <>{formatMoney(main, cur)}<small className="text-[15px] font-semibold text-muted">/mo</small></>, hint: [monthlyAll.length > 1 ? `+ ${formatTotals(monthlyAll.slice(1))}/mo` : null, apiMonthly.length ? `incl. ${formatTotals(apiMonthly)} from billing APIs` : monthlyAll.length <= 1 ? "yearly plans spread over 12 months" : null].filter(Boolean).join(" · "), extra: <StackBar parts={stackParts} label="Monthly cost by platform" /> },
          { label: "Yearly run-rate", value: formatMoney(yearlyAll.find((y) => y.currency === cur)?.amount ?? 0, cur), hint: yearlyAll.length > 1 ? `+ ${formatTotals(yearlyAll.filter((y) => y.currency !== cur))} · at today's prices` : "at today's prices" },
          { label: "Renewing · 30 days", value: formatMoney(renewTotal, cur), hint: renewals.length ? `${renewals.filter((r) => r.autoRenew).length} charge${renewals.filter((r) => r.autoRenew).length === 1 ? "" : "s"}, ${short(renewals[0].date)} – ${short(renewals[renewals.length - 1].date)}${renewOther.length ? ` · also ${renewOther.join(", ")}` : ""}` : "nothing renews in 30 days" },
          { label: "Paid platforms", value: <>{totals.paid}<small className="text-[15px] font-semibold text-muted"> / {totals.count}</small></>, hint: totals.count - totals.paid ? `${totals.count - totals.paid} on a free tier` : "entered by hand" },
          { label: "% of revenue", value: share ? `${share.pct}%` : "—", hint: share ? `${formatMoney(share.spend, share.currency)} of ${formatMoney(share.revenue, share.currency)} (30d)` : stripeLive ? `no ${cur.toUpperCase()} revenue in 30 days` : "needs live Stripe revenue" },
        ]}
      />
      <p className="mt-2 px-1 text-[13px] text-muted">{new Date(`${now}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "long" })} · {totals.count} subscription{totals.count === 1 ? "" : "s"} · {cur.toUpperCase()}</p>

      <div className="mt-6 grid items-start gap-5 xl:grid-cols-[1.45fr_1fr]">
        <div className="min-w-0"><AutomaticBills bills={bills} modes={d.modes} api={combined.api} resolution={combined.resolution} owner={owner} today={now} /></div>
        <div className="grid min-w-0 gap-5">
          {(showSource(d.modes.billmail) || bills.email.length > 0) && <DetectedBills bills={bills} subs={subs} businesses={businesses} sample={sampleMail} />}
          {owner && <BillCoverage rows={coverage} />}
        </div>
      </div>

      <div className="mt-5 grid items-start gap-5 xl:grid-cols-[1.45fr_1fr]">
        <div className="grid min-w-0 gap-5">
          <Card flush title="6-month trend" action={`${cur.toUpperCase()} · at today's prices`}>
            {active.length === 0 ? <Empty>Add subscriptions to see how spend moves month to month.</Empty> : !trend.hasHistory ? (
              <Empty>Everything here was added this month, so there&apos;s no trend yet. It builds up from when each subscription is added or stopped.</Empty>
            ) : (
              <>
                <div className="relative mx-4 mb-2 mt-5 h-60 sm:mx-5" style={{ backgroundImage: "linear-gradient(var(--color-line) 1px, transparent 1px)", backgroundSize: "100% 25%" }}>
                  <div className="absolute inset-0 grid grid-cols-6 items-end gap-2 border-b border-line sm:gap-4" role="img" aria-label={`Monthly cost over the last 6 months: ${trend.months.map((m) => `${monthName(m.month)} ${formatMoney(m.amount, cur)}`).join(", ")}`}>
                    {trend.months.map((m, i) => {
                      const last = i === trend.months.length - 1;
                      return (
                        <div key={m.month} className="flex h-full flex-col items-center justify-end gap-1.5">
                          <span className="whitespace-nowrap text-[12px] font-medium tabular-nums text-ink sm:text-[13px]">{m.amount ? formatMoney(m.amount, cur).replace(/\.00$/, "") : "—"}</span>
                          <i className="block w-full max-w-14 rounded-t-[4px]" style={{ height: `${(m.amount / trendMax) * 75}%`, background: SYS.blue, opacity: last ? 1 : 0.45 }} />
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="mx-4 grid grid-cols-6 gap-2 sm:mx-5 sm:gap-4">
                  {trend.months.map((m, i) => <span key={m.month} className={`text-center text-[12px] ${i === trend.months.length - 1 ? "font-semibold text-ink" : "text-muted"}`}>{monthName(m.month)}</span>)}
                </div>
                <p className="px-4 pb-3 pt-2 text-[13px] text-muted sm:px-5">Approximate: each subscription counts from the month it was added until it stopped being tracked, at its current price. Price changes aren&apos;t recorded.</p>
                <div className="grid grid-cols-3 border-t border-line">
                  <div className="border-r border-line px-4 py-3 sm:px-5"><div className="text-[13px] text-muted">Average</div><div className="mt-0.5 text-[17px] font-semibold tabular-nums text-ink">{formatMoney(Math.round(withData.reduce((n, m) => n + m.amount, 0) / Math.max(1, withData.length)), cur)}</div></div>
                  <div className="border-r border-line px-4 py-3 sm:px-5"><div className="text-[13px] text-muted">Since {monthName(withData[0]?.month ?? trend.months[0].month)}</div><div className="mt-0.5 text-[17px] font-semibold tabular-nums text-ink">{(() => { const delta = trend.months[trend.months.length - 1].amount - (withData[0]?.amount ?? 0); return `${delta >= 0 ? "+" : "−"}${formatMoney(Math.abs(delta), cur)}`; })()}</div></div>
                  <div className="px-4 py-3 sm:px-5"><div className="text-[13px] text-muted">Stopped · 30d</div><div className={`mt-0.5 text-[17px] font-semibold tabular-nums ${changes.stopped.length ? "text-ok" : "text-ink"}`}>{changes.stopped.length ? `${savedMonthly}/mo` : "—"}</div></div>
                </div>
              </>
            )}
          </Card>
          {!trend.hasHistory && chargedTo}
        </div>

        <div className="grid min-w-0 gap-5">
          <Card flush title="What changed · last 30 days" action={`${changes.added.length} added · ${changes.stopped.length} stopped`}>
            {changes.added.length + changes.stopped.length === 0 ? <Empty>No subscriptions added or stopped in the last 30 days.</Empty> : (
              <ul>
                {changes.added.map((s) => <li key={s.id} className="flex min-h-11 items-center justify-between gap-3 border-b border-line px-4 py-2 text-[15px] last:border-0 sm:px-5"><span className="min-w-0 truncate text-ink">{s.vendor}<span className="text-muted"> · new{s.business ? ` · ${s.business}` : ""}</span></span><b className="shrink-0 font-semibold tabular-nums text-ink">+{formatMoney(monthlyOf(s), s.currency)}</b></li>)}
                {changes.stopped.map((s) => <li key={s.id} className="flex min-h-11 items-center justify-between gap-3 border-b border-line px-4 py-2 text-[15px] last:border-0 sm:px-5"><span className="min-w-0 truncate text-ink">{s.vendor}<span className="text-muted"> · stopped{s.business ? ` · ${s.business}` : ""}</span></span><b className="shrink-0 font-semibold tabular-nums text-ok">−{formatMoney(monthlyOf(s), s.currency)}</b></li>)}
              </ul>
            )}
          </Card>
          {trend.hasHistory && chargedTo}
        </div>
      </div>

      <div className="mt-5 grid items-start gap-5 xl:grid-cols-[1.45fr_1fr]">
        <Card flush title="All platforms" action={`${list.length} · ${show === "stopped" ? "not tracked" : "sorted by monthly cost"}`}>
          <div className="border-b border-line px-4 py-3 sm:px-5">
            <FilterRow>
              {(Object.keys(FILTERS) as Filter[]).map((f) => <FilterChip key={f} href={f === "all" ? "/spend" : `/spend?show=${f}`} on={show === f}>{FILTERS[f]}</FilterChip>)}
            </FilterRow>
          </div>
          {list.length === 0 ? <Empty>{subs.length === 0 ? "Add the services you pay for (hosting, email, domains, design tools…) to see monthly cost per business and get renewal reminders." : "Nothing matches this filter."}</Empty> : (
            <div role="table" aria-label="Platforms">
              <div role="row" className="hidden grid-cols-[29px_minmax(0,1.5fr)_minmax(0,1fr)_68px_56px_84px_auto] gap-3 border-b border-line px-5 py-2.5 lg:grid">
                {["", "Platform", "Business", "Billing", "Renews", "/ mo", ""].map((h, i) => <span key={i} role="columnheader" className={`${colHead} ${h === "/ mo" ? "text-right" : ""}`}>{h}</span>)}
              </div>
              {list.map((s) => {
                const next = s.active ? nextDate(s, now) : null;
                const days = next ? daysBetween(now, next) : null;
                const flag = problemIds.has(s.id);
                const free = s.amountMinor === 0;
                return (
                  <div key={s.id} id={`sub-${s.id}`} className={`scroll-mt-24 ${s.active ? "" : "opacity-60"}`}>
                    <SubscriptionRow
                      businesses={businesses}
                      className={grid}
                      actionsClassName="col-span-full flex justify-end lg:col-span-1"
                      compact
                      s={{ id: s.id, active: s.active, vendor: s.vendor, plan: s.plan, amount: toInputAmount(s.amountMinor, s.currency), currency: s.currency.toUpperCase(), interval: s.interval, nextRenewal: s.nextRenewal, autoRenew: s.autoRenew, business: s.business, url: s.url, notes: s.notes }}
                    >
                      <Monogram name={s.vendor} />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-[15px] text-ink">
                          {s.url ? <a href={s.url} target="_blank" rel="noreferrer" className="hover:text-cyan">{s.vendor}</a> : s.vendor}
                          {flag && <Tag color={days !== null && days < 0 ? SYS.red : SYS.orange}>{days !== null && days < 0 ? "Ended" : "Ends soon"}</Tag>}
                          {!s.active && <Tag>Not tracked</Tag>}
                          {combined.resolution.excludedSubIds.has(s.id) && <Tag color={SYS.blue} title="You chose the billing API's amount for this vendor; this entry isn't counted">Billing API counts instead</Tag>}
                        </div>
                        <div className="truncate text-[13px] text-muted">{[s.plan, free ? "Free tier" : null].filter(Boolean).join(" · ") || "—"}</div>
                        <div className="text-[13px] text-muted lg:hidden">
                          {s.business ?? "Unassigned"} · {free ? "free" : `${formatMoney(s.amountMinor, s.currency)}/${s.interval === "month" ? "mo" : "yr"}`}{next ? ` · ${s.autoRenew ? "renews" : "ends"} ${short(next)}` : ""}
                        </div>
                      </div>
                      <div className="hidden min-w-0 lg:block"><BizLabel name={s.business ?? "Unassigned"} className="max-w-full overflow-hidden whitespace-nowrap" /></div>
                      <span className="hidden text-[13px] text-muted lg:block">{free ? "Free" : s.interval === "month" ? "Monthly" : "Yearly"}</span>
                      <span className={`hidden text-[13px] tabular-nums lg:block ${flag ? (days! < 0 ? "text-critical" : "text-warn") : "text-muted"}`}>{next ? short(next) : "—"}</span>
                      <span className={`text-right text-[15px] font-semibold tabular-nums ${free ? "text-muted" : "text-ink"}`}>{formatMoney(monthlyOf(s), s.currency)}</span>
                    </SubscriptionRow>
                  </div>
                );
              })}
              {show !== "stopped" && (
                <div className="flex min-h-11 items-center justify-between bg-panel-2/60 px-4 py-3 sm:px-5">
                  <span className="text-[15px] font-semibold text-ink">Total</span>
                  <span className="text-[17px] font-bold tabular-nums text-ink">{listTotal}/mo</span>
                </div>
              )}
            </div>
          )}
        </Card>

        <Card flush title="Renewals · next 30 days" action={renewals.length ? formatMoney(renewTotal, cur) : undefined}>
          {renewals.length === 0 ? <Empty>Nothing renews in the next 30 days{active.some((s) => !s.nextRenewal) ? ". Add renewal dates to see them here" : ""}.</Empty> : (
            <ol>
              {renewals.map((r) => {
                const flag = !r.autoRenew;
                const dt = new Date(`${r.date}T00:00:00Z`);
                return (
                  <li key={`${r.id}-${r.date}`} className="grid grid-cols-[44px_minmax(0,1fr)] items-center gap-3 border-b border-line px-4 py-2.5 last:border-0 sm:grid-cols-[44px_minmax(0,1fr)_auto] sm:px-5">
                    <div className="overflow-hidden rounded-[9px] bg-panel-2 text-center shadow-[0_0_0_1px_var(--color-line)]">
                      <div className={`py-0.5 text-[12px] font-semibold leading-tight ${flag ? "bg-high text-white" : "bg-fill text-muted"}`}>{dt.toLocaleDateString("en-US", { timeZone: "UTC", month: "short" })}</div>
                      <b className="block py-0.5 text-[17px] font-semibold leading-tight tabular-nums text-ink">{dt.getUTCDate()}</b>
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-[15px] text-ink">{r.vendor}{r.plan ? <span className="text-[13px] text-muted">{r.plan}</span> : null}{flag ? <Tag color={SYS.orange}>Ends · no auto-renew</Tag> : r.interval === "year" ? <Tag color={SYS.blue}>Yearly</Tag> : null}</div>
                      <div className="text-[13px] text-muted">{r.business ?? "Unassigned"} · <span className="tabular-nums">{formatMoney(r.amount, r.currency)}</span> · {relativeDays(r.days)}</div>
                    </div>
                    <span className="max-sm:hidden"><a href={`#sub-${r.id}`} className={act}>Details</a></span>
                  </li>
                );
              })}
            </ol>
          )}
        </Card>
      </div>

      <div id="add-subscription" className="scroll-mt-24">
        <Card className="mt-5" title="Add subscription" action="entered by hand">
          <SubscriptionForm businesses={businesses} inline />
        </Card>
      </div>
    </>
  );
}
