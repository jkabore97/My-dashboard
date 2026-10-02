import { getDashboard } from "@/lib/server/dashboard";
import { formatDate, relativeDays, today } from "@/lib/dates";
import { formatMoney, formatTotals, toInputAmount } from "@/lib/money";
import { dailyRevenue, liveAccounts, moneyOverview } from "@/lib/money-summary";
import { Card, Empty, PageHeader, Stat, Table, td } from "@/components/ui";
import { RevenueBars } from "@/components/RevenueBars";
import { InvoiceActions, InvoiceForm, ReopenInvoice, SubscriptionForm, SubscriptionRowActions } from "@/components/records";

export default async function MoneyPage() {
  const d = await getDashboard();
  const now = today();
  const samples = { samples: d.modes.stripe !== "live" };
  const m = moneyOverview(d.stripe, d.records, now, samples);
  const chart = dailyRevenue(d.stripe, now, samples);
  const testAccounts = d.stripe.filter((a) => !a.livemode && !a.sample).length;
  const businesses = [...new Set([...d.stripe.map((a) => a.business), ...d.records.subscriptions.map((s) => s.business), ...d.records.invoices.map((i) => i.business), ...d.openTasks.map((t) => t.business)].filter(Boolean))].sort() as string[];
  const recentlyPaid = d.records.invoices.filter((i) => i.status !== "open");
  const subs = d.records.subscriptions;

  return (
    <>
      <PageHeader mode={d.modes.stripe} title="Money" subtitle="Revenue from Stripe, money owed to you, and what your software costs each month. Currencies are never converted." />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Revenue (30d)" value={formatTotals(m.gross30d.slice(0, 1), { compact: true })} hint={m.gross30d.length > 1 ? `+ ${formatTotals(m.gross30d.slice(1), { compact: true })}` : "gross, all accounts"} />
        <Stat label="Net (30d)" value={formatTotals(m.net30d.slice(0, 1), { compact: true })} hint="after fees and refunds" />
        <Stat label="MRR" value={formatTotals(m.mrr.slice(0, 1), { compact: true })} hint="active subscriptions, before discounts" />
        <Stat label="Available" value={formatTotals(m.available.slice(0, 1), { compact: true })} hint="Stripe balance" />
        <Stat label="Owed to you" value={formatTotals(m.outstanding.slice(0, 1), { compact: true })} tone={m.overdueCount ? "high" : "ink"} hint={m.overdueCount ? `${m.overdueCount} overdue` : "nothing overdue"} />
        <Stat label="Monthly spend" value={formatTotals(m.monthlySpend.slice(0, 1), { compact: true })} hint={`${m.spend.length} subscription${m.spend.length === 1 ? "" : "s"}`} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-5">
        <Card className="xl:col-span-3" title={`Daily revenue, last 30 days (${chart.currency.toUpperCase()})`}>
          {liveAccounts(d.stripe, samples).length ? <RevenueBars days={chart.days} currency={chart.currency} /> : <Empty>{d.stripe.length ? "Only test-mode Stripe accounts are connected; their revenue isn't charted." : "Connect Stripe on the Platforms page to see revenue."}</Empty>}
          {chart.otherCurrencies.length > 0 && <p className="mt-2 text-xs text-muted">Also earning in {chart.otherCurrencies.map((c) => c.toUpperCase()).join(", ")}; see the table.</p>}
        </Card>
        <Card className="xl:col-span-2" title="By Stripe account">
          {testAccounts > 0 && <p className="mb-2 text-xs text-muted">Accounts marked test are excluded from totals, the chart and tasks.</p>}
          {d.stripe.length === 0 ? <Empty>No Stripe accounts connected.</Empty> : (
            <ul className="-my-2 divide-y divide-line text-sm">
              {d.stripe.map((a) => (
                <li key={a.id} className="py-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium">{a.business}{!a.livemode && !a.sample && <span className="ml-2 rounded bg-high/20 px-1 text-[10px] uppercase text-high">test</span>}</span>
                    <span className="tabular-nums">{formatTotals(a.revenue.map((r) => ({ currency: r.currency, amount: r.gross })))}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-muted">
                    MRR {formatTotals(a.mrr)} · {a.activeSubscriptions} active{a.pastDueSubscriptions ? `, ${a.pastDueSubscriptions} past due` : ""} · balance {formatTotals(a.balance.map((b) => ({ currency: b.currency, amount: b.available })))}
                    {a.disputes.length > 0 && <span className="text-critical"> · {a.disputes.length} open dispute{a.disputes.length === 1 ? "" : "s"}</span>}
                    {a.truncated && <span> · showing the first 1,000 records</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <h2 id="receivables" className="mb-3 mt-10 flex scroll-mt-6 flex-wrap items-center justify-between gap-3 text-sm font-semibold uppercase tracking-wider text-muted">
        <span>Owed to you</span>
        <span className="normal-case tracking-normal"><InvoiceForm businesses={businesses} /></span>
      </h2>
      <Card>
        {m.receivables.length === 0 ? <Empty>No open invoices. Add invoices you send outside Stripe to track them here.</Empty> : (
          <Table head={["Client", "Business", "Amount", "Due", "Source", ""]}>
            {m.receivables.map((r) => (
              <tr key={`${r.source}-${r.id}`}>
                <td className={td}>{r.url ? <a href={r.url} target="_blank" rel="noreferrer" className="hover:text-accent">{r.client}</a> : r.client}<div className="text-xs text-muted">{r.number ?? ""}</div></td>
                <td className={`${td} text-muted`}>{r.business ?? "—"}</td>
                <td className={`${td} tabular-nums`}>{formatMoney(r.amount, r.currency)}</td>
                <td className={`${td} ${r.daysLate ? (r.daysLate > 30 ? "text-critical" : "text-high") : "text-muted"}`}>{r.dueOn ? `${formatDate(r.dueOn)}${r.daysLate ? ` · ${r.daysLate}d late` : ""}` : "—"}</td>
                <td className={`${td} text-muted`}>{r.source === "stripe" ? "Stripe" : "Manual"}</td>
                <td className={td}>{r.editable && <InvoiceActions id={r.id} client={r.client} />}</td>
              </tr>
            ))}
          </Table>
        )}
        {recentlyPaid.length > 0 && (
          <details className="mt-4 border-t border-line pt-3">
            <summary className="cursor-pointer text-xs text-accent">Paid or voided in the last 90 days ({recentlyPaid.length})</summary>
            <ul className="mt-2 divide-y divide-line text-sm">
              {recentlyPaid.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-3 py-2">
                  <span>{i.client}{i.number ? <span className="text-muted"> · {i.number}</span> : null} · {formatMoney(i.amountMinor, i.currency)} <span className="text-xs text-muted">{i.status === "paid" ? `paid ${i.paidOn ? formatDate(i.paidOn) : ""}` : "voided"}</span></span>
                  <ReopenInvoice id={i.id} />
                </li>
              ))}
            </ul>
          </details>
        )}
      </Card>

      <h2 id="spend" className="mb-3 mt-10 flex scroll-mt-6 flex-wrap items-center justify-between gap-3 text-sm font-semibold uppercase tracking-wider text-muted">
        <span>Subscriptions &amp; spend</span>
        <span className="normal-case tracking-normal"><SubscriptionForm businesses={businesses} /></span>
      </h2>
      <Card>
        {subs.length === 0 ? <Empty>Add the services you pay for (hosting, email, domains, design tools…) to see monthly cost per business and get renewal reminders.</Empty> : (
          <ul className="-my-2 divide-y divide-line">
            {subs.map((s) => {
              const line = m.spend.find((l) => l.id === s.id);
              const days = line?.nextRenewal ? Math.round((Date.parse(`${line.nextRenewal}T00:00:00Z`) - Date.parse(`${now}T00:00:00Z`)) / 86_400_000) : null;
              return (
                <li key={s.id} className={`flex flex-wrap items-start justify-between gap-3 py-3 ${s.active ? "" : "opacity-50"}`}>
                  <div className="min-w-0 flex-1 basis-56">
                    <div className="text-sm">{s.url ? <a href={s.url} target="_blank" rel="noreferrer" className="hover:text-accent">{s.vendor}</a> : s.vendor}{s.plan ? <span className="text-muted"> · {s.plan}</span> : null}{!s.active && <span className="ml-2 text-xs text-muted">(not tracked)</span>}</div>
                    <div className="text-xs text-muted">
                      {s.business ?? "Unassigned"} · {formatMoney(s.amountMinor, s.currency)}/{s.interval === "month" ? "mo" : "yr"}
                      {s.interval === "year" && line ? ` (${formatMoney(line.monthly, s.currency)}/mo)` : ""}
                      {line?.nextRenewal ? ` · ${s.autoRenew ? "renews" : "expires"} ${formatDate(line.nextRenewal)}${days !== null ? ` (${relativeDays(days)})` : ""}` : ""}
                    </div>
                  </div>
                  <SubscriptionRowActions businesses={businesses} s={{ id: s.id, active: s.active, vendor: s.vendor, plan: s.plan, amount: toInputAmount(s.amountMinor, s.currency), currency: s.currency.toUpperCase(), interval: s.interval, nextRenewal: s.nextRenewal, autoRenew: s.autoRenew, business: s.business, url: s.url, notes: s.notes }} />
                </li>
              );
            })}
          </ul>
        )}
        {m.spend.length > 0 && (
          <div className="mt-4 grid gap-2 border-t border-line pt-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {[...new Set(m.spend.map((l) => l.business ?? "Unassigned"))].sort().map((b) => {
              const lines = m.spend.filter((l) => (l.business ?? "Unassigned") === b);
              const totals = new Map<string, number>();
              for (const l of lines) totals.set(l.currency, (totals.get(l.currency) ?? 0) + l.monthly);
              return (
                <div key={b} className="flex justify-between gap-2 rounded-lg bg-panel-2/50 px-3 py-2">
                  <span className="text-muted">{b}</span>
                  <span className="tabular-nums">{formatTotals([...totals].map(([currency, amount]) => ({ currency, amount })))}/mo</span>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </>
  );
}
