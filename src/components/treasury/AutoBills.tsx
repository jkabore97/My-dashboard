import type { ReactNode } from "react";
import { formatDate } from "@/lib/dates";
import { formatMoney, formatTotals, toInputAmount, type CurrencyAmount } from "@/lib/money";
import { aggregateGcpCosts, firebaseConsole, gcpBillingConsole, gcpConsole } from "@/lib/billing/google";
import { AZURE_BILLING, M365_ADMIN } from "@/lib/billing/microsoft";
import { vendorKey } from "@/lib/billing/email";
import { recentMonths, type ApiSpend, type SpendResolution } from "@/lib/billing/spend";
import type { CoverageHow, CoverageRow } from "@/lib/billing/coverage";
import type { Bills, InvoiceStatus } from "@/lib/billing/types";
import type { SourceMode } from "@/lib/types";
import { samplesEnabled } from "@/lib/source";
import { BizLabel, Card, Empty, Tag } from "@/components/ui";
import { SubscriptionForm } from "@/components/records";
import { Meter } from "@/components/treasury/ui";
import { act } from "@/components/treasury/styles";
import { SpendChoice } from "@/components/treasury/SpendChoice";

// The Platform spend page's automatic sections: bills read from billing APIs,
// bills recognised in shared mailboxes, and which platform's bill is known how.
// Server components; the only client parts are the choice toggle and the form.

const API_TAG = <Tag color="#3fd0ff" title="Read automatically from the platform's billing API">Billing API</Tag>;
const SAMPLE_TAG = <Tag title="Sample data: connect the platform to see yours">Sample</Tag>;
const monthName = (ym: string, year = false) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", ...(year ? { year: "numeric" } : {}) });
const short = (date: string) => formatDate(date).replace(/, \d{4}$/, "");
const STATUS: Record<InvoiceStatus, [string, string]> = { due: ["Due", "#3fd0ff"], overdue: ["Overdue", "#ff3d6e"], paid: ["Paid", "#7f97ab"], void: ["Void", "#7f97ab"], other: ["—", "#7f97ab"] };

/** Whether a source's data should be shown: real data, or samples while developing. */
export const showSource = (mode: SourceMode | undefined) => mode === "live" || (mode !== undefined && samplesEnabled());

function Block({ title, tags, right, children }: { title: ReactNode; tags?: ReactNode; right?: ReactNode; children: ReactNode }) {
  return (
    <div className="border-b border-line/70 px-4 py-4 last:border-0 sm:px-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="font-display text-sm font-semibold tracking-wide text-ink">{title}</h3>
        {tags}
        {right && <div className="ml-auto flex flex-wrap items-center gap-2">{right}</div>}
      </div>
      {children}
    </div>
  );
}

function Counted({ vendor, r, owner }: { vendor: string; r: SpendResolution; owner: boolean }) {
  const v = r.vendors.find((x) => x.vendor === vendor);
  if (!v) return null;
  return (
    <>
      <span className="text-[11px] text-muted">{v.included ? "Counts in the monthly total" : "Not in the total: your own entry is used"}</span>
      {owner && v.hasManual && <SpendChoice vendor={vendor} choice={v.choice} />}
    </>
  );
}

function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="hud-label truncate text-[11px] text-muted">{label}</div>
      <div className="mt-1 truncate font-mono text-base tabular-nums text-ink">{value}</div>
      {hint && <div className="truncate text-[11px] text-muted">{hint}</div>}
    </div>
  );
}

export function AutomaticBills({ bills, modes, api, resolution, owner, today }: { bills: Bills; modes: Record<string, SourceMode>; api: ApiSpend[]; resolution: SpendResolution; owner: boolean; today: string }) {
  const ms = bills.microsoft;
  const g = bills.google;
  const showMs = showSource(modes.msadmin) && (ms.billing.invoices.length > 0 || ms.billing.accounts.length > 0 || !!ms.billing.error);
  const showG = showSource(modes.gcloud) && (g.costs.length > 0 || g.projects.length > 0 || !!g.export.status);
  const others = showSource(modes.billing) ? bills.platforms.filter((p) => p.status) : [];
  const stripeFees = api.find((a) => a.vendor === "stripe");
  const nothing = !showMs && !showG && !others.length && !stripeFees;

  return (
    <Card flush accent="cyan" title="Automatic bills" action="read from billing APIs · never converted">
      {nothing ? (
        <Empty>{owner ? "No billing API connected yet. Connect Microsoft 365 admin or Google Cloud on Platforms, or give Cloudflare and GitHub tokens billing access." : "No automatic bills you can see yet."}</Empty>
      ) : (
        <>
          {showMs && <MicrosoftBlock bills={bills} sample={modes.msadmin !== "live"} resolution={resolution} owner={owner} today={today} api={api.find((a) => a.vendor === "microsoft")} />}
          {showG && <GoogleBlock bills={bills} sample={modes.gcloud !== "live"} resolution={resolution} owner={owner} today={today} api={api.find((a) => a.vendor === "google-cloud")} />}
          {others.map((p) => {
            const a = api.find((x) => x.vendor === p.platform);
            const months = [...new Set(p.charges.map((c) => c.date.slice(0, 7)))].sort().slice(-3);
            return (
              <Block key={p.platform} title={p.vendor} tags={<>{p.status === "ok" ? API_TAG : null}{modes.billing !== "live" && SAMPLE_TAG}{p.plan && <Tag>{p.plan}</Tag>}</>} right={a ? <Counted vendor={p.platform} r={resolution} owner={owner} /> : null}>
                {p.status === "ok" && months.length > 0 ? (
                  <div className="grid grid-cols-3 gap-3">
                    {months.map((m) => {
                      const t: CurrencyAmount[] = [];
                      for (const c of p.charges.filter((x) => x.date.startsWith(m))) {
                        const e = t.find((x) => x.currency === c.currency);
                        if (e) e.amount += c.amountMinor;
                        else t.push({ currency: c.currency, amount: c.amountMinor });
                      }
                      return <Stat key={m} label={monthName(m, true)} value={formatTotals(t)} hint={m === today.slice(0, 7) ? "so far" : undefined} />;
                    })}
                  </div>
                ) : null}
                {p.message && <p className={`mt-2 text-xs ${p.status === "permission" || p.status === "error" ? "text-high" : "text-muted"}`}>{p.message}</p>}
              </Block>
            );
          })}
          {stripeFees && (
            <Block title="Stripe processing fees" tags={<Tag color="#ffd84d">Stripe balance</Tag>} right={<Counted vendor="stripe" r={resolution} owner={owner} />}>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Stat label="Last 30 days" value={formatTotals(stripeFees.amounts)} hint="what Stripe kept from your charges" />
                {[...new Set(stripeFees.byBusiness.map((b) => b.business ?? "Unassigned"))].slice(0, 2).map((b) => (
                  <Stat key={b} label={b} value={formatTotals(stripeFees.byBusiness.filter((x) => (x.business ?? "Unassigned") === b).map((x) => ({ currency: x.currency, amount: x.amount })))} />
                ))}
              </div>
            </Block>
          )}
        </>
      )}
    </Card>
  );
}

function MicrosoftBlock({ bills, sample, resolution, owner, today, api }: { bills: Bills; sample: boolean; resolution: SpendResolution; owner: boolean; today: string; api?: ApiSpend }) {
  const b = bills.microsoft.billing;
  const inv = b.invoices;
  const latest = inv.find((i) => i.totalMinor !== null);
  const open = inv.filter((i) => (i.status === "due" || i.status === "overdue") && (i.dueMinor ?? i.totalMinor ?? 0) > 0);
  const dueTotals: CurrencyAmount[] = [];
  for (const i of open) {
    if (!i.currency) continue;
    const e = dueTotals.find((x) => x.currency === i.currency);
    const amt = i.dueMinor ?? i.totalMinor ?? 0;
    if (e) e.amount += amt;
    else dueTotals.push({ currency: i.currency, amount: amt });
  }
  const nextDue = open.map((i) => i.dueDate).filter((d): d is string => !!d).sort()[0];
  return (
    <Block title="Microsoft 365 / Azure" tags={<>{API_TAG}{sample && SAMPLE_TAG}</>} right={api ? <Counted vendor="microsoft" r={resolution} owner={owner} /> : null}>
      {b.error && <p className="mb-3 text-xs text-high">{b.error}</p>}
      {inv.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Latest invoice" value={latest && latest.currency ? formatMoney(latest.totalMinor!, latest.currency) : "—"} hint={latest?.date ? short(latest.date) : undefined} />
            <Stat label="Amount due" value={dueTotals.length ? formatTotals(dueTotals) : "Nothing due"} hint={`${open.length} open invoice${open.length === 1 ? "" : "s"}`} />
            <Stat label="Next due" value={nextDue ? short(nextDue) : "—"} hint={nextDue && nextDue < today ? "overdue" : undefined} />
            <Stat label="Invoices · 12 mo" value={inv.length} hint={b.accounts.map((a) => a.displayName).slice(0, 2).join(", ")} />
          </div>
          <ul className="mt-3">
            {inv.slice(0, 6).map((i) => (
              <li key={i.id} className="grid grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-3 border-b border-dashed border-line/70 py-2 text-[13px] last:border-0">
                <span className="font-mono text-xs text-muted">{i.date ? monthName(i.date.slice(0, 7), true) : "—"}</span>
                <span className="min-w-0 truncate">{i.number}{i.profile ? <span className="text-muted"> · {i.profile}</span> : null} <Tag color={STATUS[i.status][1]}>{STATUS[i.status][0]}</Tag></span>
                <span className="font-mono tabular-nums">{i.totalMinor !== null && i.currency ? formatMoney(i.totalMinor, i.currency) : <span className="text-muted">see portal</span>}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {owner && (
        <div className="mt-3 flex flex-wrap gap-2">
          <a href={`${M365_ADMIN}#/billoverview/invoice-list`} target="_blank" rel="noreferrer" className={act}>Bills &amp; payments</a>
          <a href={AZURE_BILLING} target="_blank" rel="noreferrer" className={act}>Azure billing</a>
        </div>
      )}
    </Block>
  );
}

function GoogleBlock({ bills, sample, resolution, owner, today, api }: { bills: Bills; sample: boolean; resolution: SpendResolution; owner: boolean; today: string; api?: ApiSpend }) {
  const g = bills.google;
  const s = aggregateGcpCosts(g.costs);
  const months = recentMonths(today);
  const cur = s.months.flatMap((m) => m.totals)[0]?.currency ?? "usd";
  const amountIn = (t: CurrencyAmount[] | undefined) => t?.find((x) => x.currency === cur)?.amount ?? 0;
  const max = Math.max(1, ...s.months.map((m) => amountIn(m.totals)));
  const thisM = today.slice(0, 7);
  const lastM = months[months.length - 2];
  return (
    <Block title="Google Cloud / Firebase" tags={<>{API_TAG}{sample && SAMPLE_TAG}</>} right={api ? <Counted vendor="google-cloud" r={resolution} owner={owner} /> : null}>
      {g.export.status === "none" && owner && <p className="mb-3 text-xs text-muted">No billing export table yet, so costs aren&apos;t known. In the Cloud console: Billing → Billing export → BigQuery export → Standard usage cost, pick a dataset, then add the table on Platforms → Google Cloud.</p>}
      {(g.export.status === "empty" || g.export.status === "error") && g.export.error && <p className={`mb-3 text-xs ${g.export.status === "error" ? "text-high" : "text-muted"}`}>{g.export.error}</p>}
      {s.months.length > 0 && (
        <>
          <div className="grid grid-cols-6 items-end gap-2" role="img" aria-label={`Google Cloud net cost per month: ${months.map((m) => `${monthName(m)} ${formatMoney(amountIn(s.months.find((x) => x.month === m)?.totals), cur)}`).join(", ")}`}>
            {months.map((m) => {
              const v = amountIn(s.months.find((x) => x.month === m)?.totals);
              return (
                <div key={m} className="flex h-28 flex-col items-center justify-end gap-1">
                  <span className="font-mono text-[10.5px] tabular-nums">{v ? formatMoney(v, cur).replace(/\.\d+$/, "") : "—"}</span>
                  <i className="block w-full max-w-12" style={{ height: `${(Math.max(0, v) / max) * 70}%`, background: "linear-gradient(180deg, #2ef2d0, rgb(63 208 255 / 0.3))", opacity: m === thisM ? 0.6 : 1 }} />
                  <span className={`hud-label text-[10.5px] ${m === thisM ? "text-gold" : "text-muted"}`}>{monthName(m)}</span>
                </div>
              );
            })}
          </div>
          <p className="mt-1 text-[11px] text-muted">Net of credits, by invoice month. {monthName(thisM)} is month-to-date (export data lags about a day).</p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[420px] text-[13px]">
              <thead>
                <tr className="text-left">
                  {["Project", monthName(lastM), monthName(thisM), "6 months"].map((h, i) => <th key={h} className={`hud-label pb-1.5 text-[11px] font-normal text-muted ${i ? "text-right" : ""}`}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {s.projects.slice(0, 8).map((p) => (
                  <tr key={p.key} className="border-t border-dashed border-line/70">
                    <td className="py-1.5 pr-2">
                      <div className="truncate">{p.projectId && owner ? <a href={gcpBillingConsole(p.projectId)} target="_blank" rel="noreferrer" className="hover:text-cyan">{p.name}</a> : p.name}</div>
                      {p.business && <BizLabel name={p.business} />}
                    </td>
                    <td className="py-1.5 text-right font-mono tabular-nums">{formatTotals(p.byMonth[lastM] ?? [])}</td>
                    <td className="py-1.5 text-right font-mono tabular-nums">{formatTotals(p.byMonth[thisM] ?? [])}</td>
                    <td className="py-1.5 text-right font-mono tabular-nums">{formatTotals(p.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {s.services.length > 0 && (
            <div className="mt-3">
              <div className="hud-label mb-1 text-[11px] text-muted">Top services · 6 months</div>
              {s.services.slice(0, 5).map((x) => (
                <div key={x.service} className="grid grid-cols-[minmax(0,140px)_1fr_auto] items-center gap-3 py-1 text-[12.5px] sm:grid-cols-[minmax(0,200px)_1fr_auto]">
                  <span className="truncate text-muted">{x.service}</span>
                  <Meter pct={(amountIn(x.total) / Math.max(1, amountIn(s.services[0].total))) * 100} color="#2ef2d0" />
                  <span className="font-mono tabular-nums">{formatTotals(x.total)}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
      {owner && g.projects.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          <a href={gcpBillingConsole()} target="_blank" rel="noreferrer" className={act}>Cloud billing</a>
          {g.projects.filter((p) => p.firebase).slice(0, 3).map((p) => <a key={p.projectId} href={firebaseConsole(p.projectId)} target="_blank" rel="noreferrer" className={act}>Firebase · {p.name}</a>)}
          {g.projects.filter((p) => !p.firebase).slice(0, 2).map((p) => <a key={p.projectId} href={gcpConsole(p.projectId)} target="_blank" rel="noreferrer" className={act}>{p.name}</a>)}
        </div>
      )}
    </Block>
  );
}

/** Bills recognised in shared mailboxes: never counted until tracked. */
export function DetectedBills({ bills, subs, businesses, sample }: { bills: Bills; subs: { vendor: string; active: boolean }[]; businesses: string[]; sample: boolean }) {
  const tracked = new Set(subs.filter((s) => s.active).map((s) => vendorKey(s.vendor)));
  const latest = new Map<string, Bills["email"][number]>();
  for (const b of bills.email) if (!latest.has(b.vendorKey)) latest.set(b.vendorKey, b);
  const open = [...latest.values()].filter((b) => !tracked.has(b.vendorKey));
  const done = latest.size - open.length;
  return (
    <Card flush accent="violet" title="Detected from e-mail · check" action={`${open.length} to review${done ? ` · ${done} tracked` : ""}`}>
      {open.length === 0 ? (
        <Empty>{latest.size ? "Every bill found in the shared mailboxes is tracked." : "No invoices or receipts recognised in the shared mailboxes yet."}</Empty>
      ) : (
        <ul>
          {open.map((b) => (
            <li key={b.id} className="border-b border-line/60 px-4 py-3 last:border-0 sm:px-5">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{b.vendor}</span>
                <Tag color="#a98bff" title="Read from an e-mail: check it before tracking">From e-mail</Tag>
                {sample && SAMPLE_TAG}
                <span className="ml-auto font-mono tabular-nums">{formatMoney(b.amountMinor, b.currency)}</span>
              </div>
              <div className="mt-0.5 truncate text-xs text-muted">{short(b.date)} · {b.account} · {b.url ? <a href={b.url} target="_blank" rel="noreferrer" className="hover:text-cyan">{b.subject}</a> : b.subject}</div>
              <div className="mt-2 flex flex-wrap">
                <SubscriptionForm
                  businesses={businesses}
                  label="Track as subscription"
                  draft={{ vendor: b.vendor, amount: toInputAmount(b.amountMinor, b.currency), currency: b.currency.toUpperCase(), interval: b.interval, business: b.business, autoRenew: true, notes: `Detected from a billing e-mail on ${b.date}; check the amount.` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="border-t border-line/70 px-4 py-2.5 text-[11px] text-muted sm:px-5">Shared mailboxes only. Not counted in any total until you track it.</p>
    </Card>
  );
}

const HOW: Record<CoverageHow, [string, string]> = { api: ["Billing API", "#3fd0ff"], email: ["From e-mail", "#a98bff"], manual: ["Manual entry", "#ffd84d"], none: ["Not tracked", "#7f97ab"] };

export function BillCoverage({ rows }: { rows: CoverageRow[] }) {
  return (
    <Card flush accent="teal" title="Bill coverage" action={`${rows.filter((r) => r.how !== "none").length} of ${rows.length} known`}>
      {rows.length === 0 ? <Empty>No platforms connected yet.</Empty> : (
        <ul>
          {rows.map((r) => (
            <li key={r.id} className="border-b border-line/60 px-4 py-2.5 last:border-0 sm:px-5">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="min-w-0 truncate">{r.name}</span>
                <span className="ml-auto"><Tag color={HOW[r.how][1]}>{HOW[r.how][0]}</Tag></span>
              </div>
              <div className="text-xs text-muted">{r.detail}</div>
              {r.fix && <div className="mt-0.5 text-xs text-[#9be7ff]">→ {r.fix}</div>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
