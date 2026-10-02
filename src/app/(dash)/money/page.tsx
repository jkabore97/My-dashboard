import Link from "next/link";
import { requireSection } from "@/lib/server/auth";
import { getDashboard } from "@/lib/server/dashboard";
import { daysBetween, formatDate, relativeDays, today } from "@/lib/dates";
import { formatMoney, formatTotals, toInputAmount } from "@/lib/money";
import { dailyRevenue, liveAccounts, moneyOverview } from "@/lib/money-summary";
import { BizLabel, Card, Empty, PageHeader, Tag, businessColor } from "@/components/ui";
import { RevenueBars } from "@/components/RevenueBars";
import { InvoiceActions, InvoiceForm, ReopenInvoice, SubscriptionForm, SubscriptionRow } from "@/components/records";
import { AlertRow, Meter, Metrics, Monogram, SectionHead } from "@/components/treasury/ui";
import { act } from "@/components/treasury/styles";
import { monthlyOf, nextDate, spendByBusiness } from "@/components/treasury/spend";

const DISPUTE_OPEN = new Set(["needs_response", "warning_needs_response"]);

export default async function MoneyPage() {
  await requireSection("money");
  const d = await getDashboard();
  const now = today();
  const samples = { samples: d.modes.stripe !== "live" };
  const m = moneyOverview(d.stripe, d.records, now, samples);
  const chart = dailyRevenue(d.stripe, now, samples);
  const live = liveAccounts(d.stripe, samples);
  const testAccounts = d.stripe.filter((a) => !a.livemode && !a.sample).length;
  const businesses = [...new Set([...d.stripe.map((a) => a.business), ...d.records.subscriptions.map((s) => s.business), ...d.records.invoices.map((i) => i.business), ...d.openTasks.map((t) => t.business)].filter(Boolean))].sort() as string[];
  const recentlyPaid = d.records.invoices.filter((i) => i.status !== "open");
  const subs = d.records.subscriptions;
  const activeSubs = subs.filter((s) => s.active).sort((a, b) => monthlyOf(b) - monthlyOf(a) || a.vendor.localeCompare(b.vendor));
  const topSubs = activeSubs.slice(0, 6);
  const perBusiness = spendByBusiness(subs);
  const first = <T,>(t: T[]) => t.slice(0, 1);
  const more = (t: { currency: string; amount: number }[]) => (t.length > 1 ? ` + ${formatTotals(t.slice(1), { compact: true })}` : "");

  // Money in, for the chart's currency.
  const cur = chart.currency;
  const sum = (k: "gross" | "fees" | "refunds" | "net") => live.reduce((n, a) => n + a.revenue.filter((r) => r.currency === cur).reduce((x, r) => x + r[k], 0), 0);
  const flow = { gross: sum("gross"), fees: sum("fees"), refunds: sum("refunds"), net: sum("net") };
  const grossOf = (a: (typeof d.stripe)[number]) => a.revenue.find((r) => r.currency === cur)?.gross ?? 0;
  const maxGross = Math.max(1, ...d.stripe.map(grossOf));

  // Disputes from accounts whose money is real (or samples on this page).
  const disputes = live.flatMap((a) => a.disputes.map((x) => ({ ...x, business: a.business, livemode: a.livemode })));

  return (
    <>
      <PageHeader mode={d.modes.stripe} title="Money" subtitle="Revenue from Stripe, money owed to you, and what your software costs each month. Currencies are never converted." />

      {disputes.length > 0 && (
        <Card accent="pink" flush className="mb-5">
          {disputes.map((x) => {
            const open = DISPUTE_OPEN.has(x.status);
            const due = x.dueBy ? daysBetween(now, x.dueBy.slice(0, 10)) : null;
            return (
              <AlertRow
                key={x.id}
                severity={open ? "critical" : "medium"}
                level={`${open ? "Critical" : "Under review"} · ${x.business} · Stripe dispute`}
                title={`Customer disputed a ${formatMoney(x.amount, x.currency)} charge (${x.reason.replace(/_/g, " ")})`}
                meta={open ? (x.dueBy ? `Evidence due ${formatDate(x.dueBy.slice(0, 10))} · ${relativeDays(due!)}. If unanswered, the amount and the dispute fee are lost.` : "Respond in Stripe to keep the funds.") : "Evidence submitted; the bank is deciding."}
                action={<a href={`https://dashboard.stripe.com/${x.livemode ? "" : "test/"}disputes/${x.id}`} target="_blank" rel="noreferrer" className={`${act} ${open ? "[--b:#ff3d6e]" : ""}`}>{open ? "Respond in Stripe" : "Open in Stripe"}</a>}
              />
            );
          })}
        </Card>
      )}

      <Card flush title="Treasury" action={d.modes.stripe === "live" ? `Stripe live · ${live.length} account${live.length === 1 ? "" : "s"}` : d.modes.stripe === "demo" ? "Sample Stripe data" : "Stripe connection failing"}>
        <Metrics
          cols={6}
          items={[
            { label: "Revenue · 30d", value: formatTotals(first(m.gross30d), { compact: true }), tone: "emerald", hint: m.gross30d.length > 1 ? `gross${more(m.gross30d)}` : "gross, all accounts" },
            { label: "Net · 30d", value: formatTotals(first(m.net30d), { compact: true }), tone: "teal", hint: "after fees and refunds" },
            { label: "MRR", value: formatTotals(first(m.mrr), { compact: true }), tone: "cyan", hint: "active subscriptions, before discounts" },
            { label: "Available", value: formatTotals(first(m.available), { compact: true }), tone: "gold", hint: "Stripe balance" },
            { label: "Owed to you", value: formatTotals(first(m.outstanding), { compact: true }), tone: m.overdueCount ? "high" : "ink", hint: m.overdueCount ? <span className="text-high">▲ {m.overdueCount} overdue · {formatTotals(m.overdue, { compact: true })}</span> : "nothing overdue" },
            { label: "Monthly spend", value: formatTotals(first(m.monthlySpend), { compact: true }), tone: "pink", hint: `${m.spend.length} subscription${m.spend.length === 1 ? "" : "s"}${more(m.monthlySpend)}` },
          ]}
        />
      </Card>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1.5fr_1fr]">
        <Card flush title={`Daily revenue · last 30 days (${cur.toUpperCase()})`} action={`${formatDate(chart.days[0].date).replace(/, \d{4}$/, "")} – ${formatDate(chart.days[chart.days.length - 1].date).replace(/, \d{4}$/, "")}`}>
          <div className="p-4 sm:p-5">
            {live.length ? <RevenueBars days={chart.days} currency={cur} /> : <Empty>{d.stripe.length ? "Only test-mode Stripe accounts are connected; their revenue isn't charted." : "Connect Stripe on the Platforms page to see revenue."}</Empty>}
            {chart.otherCurrencies.length > 0 && <p className="mt-2 text-xs text-muted">Also earning in {chart.otherCurrencies.map((c) => c.toUpperCase()).join(", ")}; see the accounts list.</p>}
          </div>
          {live.length > 0 && (
            <div className="grid grid-cols-2 border-t border-line/70 sm:grid-cols-4">
              {([["Gross", flow.gross, "#3df5a0"], ["Stripe fees", -flow.fees, null], ["Refunds", -flow.refunds, null], ["Net", flow.net, "#2ef2d0"]] as const).map(([k, v, c], i) => (
                <div key={k} className={`border-line/70 px-4 py-3 sm:px-5 ${i % 2 === 0 ? "border-r" : ""} ${i < 2 ? "max-sm:border-b" : ""} sm:border-r sm:last:border-r-0`}>
                  <div className="hud-label text-[11px] text-muted">{k}</div>
                  <div className={`mt-1 font-mono text-lg tabular-nums ${c ? "" : "text-muted"}`} style={c ? { color: c } : undefined}>{v < 0 ? `−${formatMoney(-v, cur)}` : formatMoney(v, cur)}</div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card flush accent="cyan" title="By Stripe account" action={`gross 30d · ${cur.toUpperCase()}`}>
          {testAccounts > 0 && <p className="px-4 pt-3 text-xs text-muted sm:px-5">Accounts marked test are excluded from totals, the chart and tasks.</p>}
          {d.stripe.length === 0 ? <Empty>No Stripe accounts connected.</Empty> : (
            <ul>
              {d.stripe.map((a) => {
                const test = !a.livemode && !a.sample;
                const c = businessColor(a.business);
                return (
                  <li key={a.id} className="border-b border-line/50 px-4 py-3 last:border-0 sm:px-5">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className={`flex min-w-0 items-center gap-2 text-sm font-medium ${test ? "text-muted" : ""}`}>{test ? a.business : <BizLabel name={a.business} className="!text-sm !text-ink" />}{test && <Tag>Test</Tag>}</span>
                      <span className={`shrink-0 font-mono text-sm tabular-nums ${test ? "text-muted" : ""}`}>{a.revenue.length ? formatTotals(a.revenue.map((r) => ({ currency: r.currency, amount: r.gross }))) : formatMoney(0, cur)}</span>
                    </div>
                    <div className="mt-0.5 text-xs text-muted">
                      {test ? "Test-mode account · excluded from totals, the chart and tasks" : <>MRR {formatTotals(a.mrr)} · {a.activeSubscriptions} active{a.pastDueSubscriptions ? <span className="text-high">, {a.pastDueSubscriptions} past due</span> : ""} · balance {formatTotals(a.balance.map((b) => ({ currency: b.currency, amount: b.available })))}</>}
                      {a.disputes.length > 0 && <span className="text-critical"> · {a.disputes.length} open dispute{a.disputes.length === 1 ? "" : "s"}</span>}
                      {a.truncated && <span> · showing the first 1,000 records</span>}
                    </div>
                    {!test && <Meter className="mt-2" pct={(grossOf(a) / maxGross) * 100} color={c} />}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <SectionHead id="receivables" title="Owed to you"><InvoiceForm businesses={businesses} /></SectionHead>
      <Card flush accent="pink">
        {m.receivables.length === 0 ? <Empty>No open invoices. Add invoices you send outside Stripe to track them here.</Empty> : (
          <div role="table" aria-label="Open invoices">
            <div role="row" className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_100px_110px_90px_minmax(200px,auto)] gap-3 border-b border-line px-5 py-2.5 lg:grid">
              {["Client", "Business", "Amount", "Due", "Source", ""].map((h, i) => <span key={i} role="columnheader" className={`hud-label text-[11px] text-muted ${h === "Amount" ? "text-right" : ""}`}>{h}</span>)}
            </div>
            {m.receivables.map((r) => (
              <div role="row" key={`${r.source}-${r.id}`} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 gap-y-2 border-b border-line/50 px-4 py-3 last:border-0 sm:px-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_100px_110px_90px_minmax(200px,auto)]">
                <div role="cell" className="min-w-0">
                  <div className="truncate text-sm">{r.url ? <a href={r.url} target="_blank" rel="noreferrer" className="hover:text-cyan">{r.client}</a> : r.client}</div>
                  <div className="text-xs text-muted"><span className="font-mono">{r.number ?? ""}</span><span className="lg:hidden">{r.business ? `${r.number ? " · " : ""}${r.business}` : ""}</span></div>
                </div>
                <div role="cell" className="hidden lg:block"><BizLabel name={r.business} />{!r.business && <span className="text-muted">—</span>}</div>
                <div role="cell" className="text-right font-mono text-sm tabular-nums">{formatMoney(r.amount, r.currency)}</div>
                <div role="cell" className={`text-sm ${r.daysLate ? (r.daysLate > 30 ? "text-critical" : "text-high") : "text-muted"}`}>
                  {r.dueOn ? <>{formatDate(r.dueOn).replace(/, \d{4}$/, "")}<div className="text-xs">{r.daysLate ? `${r.daysLate}d late` : relativeDays(daysBetween(now, r.dueOn))}</div></> : "—"}
                </div>
                <div role="cell" className="hidden lg:block">{r.source === "stripe" ? <Tag color="#a98bff">Stripe</Tag> : <Tag>Manual</Tag>}</div>
                <div role="cell" className={r.editable ? "col-span-full lg:col-span-1" : "hidden lg:block"}>{r.editable && <InvoiceActions id={r.id} client={r.client} />}</div>
              </div>
            ))}
          </div>
        )}
        {recentlyPaid.length > 0 && (
          <details className="group border-t border-line">
            <summary className="hud-label flex min-h-11 cursor-pointer items-center px-4 text-xs text-cyan sm:px-5"><span className="mr-2 inline-block transition-transform group-open:rotate-90">▸</span>Paid or voided in the last 90 days ({recentlyPaid.length})</summary>
            <ul>
              {recentlyPaid.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-line/50 px-4 py-2.5 text-sm sm:px-5">
                  <span>{i.client}{i.number ? <span className="text-muted"> · {i.number}</span> : null} · <span className="font-mono tabular-nums">{formatMoney(i.amountMinor, i.currency)}</span> <span className="text-xs text-muted">{i.status === "paid" ? `paid ${i.paidOn ? formatDate(i.paidOn) : ""}` : "voided"}</span></span>
                  <ReopenInvoice id={i.id} />
                </li>
              ))}
            </ul>
          </details>
        )}
      </Card>

      <SectionHead id="spend" title="Subscriptions & spend">
        <Link href="/spend" className={act}>Open platform spend →</Link>
        <SubscriptionForm businesses={businesses} />
      </SectionHead>
      <Card flush accent="violet" title={activeSubs.length ? `Top ${topSubs.length} of ${activeSubs.length} · ${formatTotals(m.monthlySpend)}/mo` : "Subscriptions"} action={activeSubs.length ? "sorted by monthly cost" : undefined}>
        {activeSubs.length === 0 ? <Empty>Add the services you pay for (hosting, email, domains, design tools…) to see monthly cost per business and get renewal reminders.</Empty> : (
          <>
            {topSubs.map((s) => {
              const next = nextDate(s, now);
              const days = next ? daysBetween(now, next) : null;
              const ending = !s.autoRenew && days !== null && days <= 14;
              return (
                <SubscriptionRow
                  key={s.id}
                  businesses={businesses}
                  className="grid grid-cols-[26px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 border-b border-line/50 px-4 py-3 sm:grid-cols-[26px_minmax(0,1fr)_auto_auto] sm:px-5"
                  s={{ id: s.id, active: s.active, vendor: s.vendor, plan: s.plan, amount: toInputAmount(s.amountMinor, s.currency), currency: s.currency.toUpperCase(), interval: s.interval, nextRenewal: s.nextRenewal, autoRenew: s.autoRenew, business: s.business, url: s.url, notes: s.notes }}
                >
                  <Monogram name={s.vendor} />
                  <div className="min-w-0">
                    <div className="truncate text-sm">{s.url ? <a href={s.url} target="_blank" rel="noreferrer" className="hover:text-cyan">{s.vendor}</a> : s.vendor}{s.plan ? <span className="text-muted"> · {s.plan}</span> : null}</div>
                    <div className="text-xs text-muted">
                      {s.business ?? "Unassigned"} · {formatMoney(s.amountMinor, s.currency)}/{s.interval === "month" ? "mo" : "yr"}
                      {s.interval === "year" ? ` (${formatMoney(monthlyOf(s), s.currency)}/mo)` : ""}
                      {next ? <span className={ending ? (days! < 0 ? "text-critical" : "text-high") : ""}> · {s.autoRenew ? "renews" : days! < 0 ? "ended" : "ends"} {formatDate(next).replace(/, \d{4}$/, "")} ({relativeDays(days!)}){ending && !s.autoRenew ? " · auto-renew off" : ""}</span> : ""}
                    </div>
                  </div>
                  <span className="text-right font-mono text-sm tabular-nums">{formatMoney(monthlyOf(s), s.currency)}</span>
                </SubscriptionRow>
              );
            })}
            {activeSubs.length > topSubs.length && <Link href="/spend" className="hud-label flex min-h-11 items-center px-4 text-xs text-cyan hover:underline sm:px-5">All {activeSubs.length} subscriptions, renewals and stopped ones →</Link>}
            <div className="grid gap-2 border-t border-line/70 p-4 sm:grid-cols-2 sm:p-5 lg:grid-cols-4">
              {perBusiness.map((b) => (
                <div key={b.business} className="flex items-center justify-between gap-2 border border-cyan/10 bg-cyan/[0.05] px-3 py-2 text-[13px]">
                  <span className="truncate text-muted">{b.business}</span>
                  <span className="shrink-0 font-mono tabular-nums">{formatTotals(b.totals)}/mo</span>
                </div>
              ))}
            </div>
          </>
        )}
      </Card>
    </>
  );
}
