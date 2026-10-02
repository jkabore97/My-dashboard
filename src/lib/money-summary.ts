import { daysBetween, rollForward } from "./dates";
import { sumByCurrency, toMonthly, type CurrencyAmount } from "./money";
import type { Records } from "./connectors/records";
import type { ReceivableInvoice, StripeAccountSummary } from "./types";

// Pure roll-ups for the Money page and Overview. Different currencies are
// never converted; every total is a list of per-currency amounts. Stripe
// accounts in test mode are left out of every roll-up: their money isn't real.
// Sample (demo) accounts count only where a page asks for them to show what
// the page looks like; reports, the brief and Ask never do.

export interface RollupOptions {
  /** Include sample accounts (demo display while Stripe isn't connected). */
  samples?: boolean;
}

export const liveAccounts = (stripe: StripeAccountSummary[], o: RollupOptions = {}) => stripe.filter((a) => (a.livemode && !a.sample) || (!!o.samples && !!a.sample));

export interface Receivable extends ReceivableInvoice {
  daysLate: number | null;
  /** Manual invoices only: the record can be marked paid / deleted. */
  editable: boolean;
}

export function receivables(stripe: StripeAccountSummary[], records: Records, today: string): Receivable[] {
  const all: Receivable[] = [
    ...stripe.flatMap((a) => a.openInvoices.map((i) => ({ ...i, editable: false, daysLate: null as number | null }))),
    ...records.invoices
      .filter((i) => i.status === "open")
      .map((i) => ({ id: i.id, source: "manual" as const, business: i.business, client: i.client, number: i.number, amount: i.amountMinor, currency: i.currency, dueOn: i.dueOn, editable: true, daysLate: null as number | null })),
  ];
  for (const r of all) r.daysLate = r.dueOn && r.dueOn < today ? daysBetween(r.dueOn, today) : null;
  return all.sort((a, b) => (a.dueOn ?? "9999").localeCompare(b.dueOn ?? "9999"));
}

export interface SpendLine {
  id: string;
  vendor: string;
  business: string | null;
  monthly: number;
  currency: string;
  nextRenewal: string | null;
}

export function spend(records: Records, today: string): SpendLine[] {
  return records.subscriptions
    .filter((s) => s.active)
    .map((s) => ({
      id: s.id,
      vendor: s.vendor,
      business: s.business,
      monthly: Math.round(toMonthly(s.amountMinor, s.interval)),
      currency: s.currency,
      nextRenewal: s.nextRenewal ? (s.autoRenew ? rollForward(s.nextRenewal, s.interval, today) : s.nextRenewal) : null,
    }));
}

export function moneyOverview(all: StripeAccountSummary[], records: Records, today: string, o: RollupOptions = {}) {
  const stripe = liveAccounts(all, o);
  const owed = receivables(stripe, records, today);
  const lines = spend(records, today);
  return {
    gross30d: sumByCurrency(stripe.flatMap((a) => a.revenue.map((r) => ({ currency: r.currency, amount: r.gross })))),
    net30d: sumByCurrency(stripe.flatMap((a) => a.revenue.map((r) => ({ currency: r.currency, amount: r.net })))),
    mrr: sumByCurrency(stripe.flatMap((a) => a.mrr)),
    available: sumByCurrency(stripe.flatMap((a) => a.balance.map((b) => ({ currency: b.currency, amount: b.available })))),
    outstanding: sumByCurrency(owed.map((r) => ({ currency: r.currency, amount: r.amount }))),
    overdue: sumByCurrency(owed.filter((r) => r.daysLate).map((r) => ({ currency: r.currency, amount: r.amount }))),
    overdueCount: owed.filter((r) => r.daysLate).length,
    monthlySpend: sumByCurrency(lines.map((l) => ({ currency: l.currency, amount: l.monthly }))),
    receivables: owed,
    spend: lines,
  };
}

/** Per-business money for the Overview cards. */
export function moneyByBusiness(all: StripeAccountSummary[], records: Records, today: string, o: RollupOptions = {}) {
  const stripe = liveAccounts(all, o);
  const out = new Map<string, { revenue: CurrencyAmount[]; spend: CurrencyAmount[] }>();
  const get = (b: string) => out.get(b) ?? out.set(b, { revenue: [], spend: [] }).get(b)!;
  for (const a of stripe) get(a.business).revenue.push(...a.revenue.map((r) => ({ currency: r.currency, amount: r.gross })));
  for (const l of spend(records, today)) get(l.business ?? "Unassigned").spend.push({ currency: l.currency, amount: l.monthly });
  return new Map([...out].map(([b, v]) => [b, { revenue: sumByCurrency(v.revenue), spend: sumByCurrency(v.spend) }]));
}

/** Daily gross for the busiest currency, filled to 30 days ending today. */
export function dailyRevenue(all: StripeAccountSummary[], today: string, o: RollupOptions = {}) {
  const stripe = liveAccounts(all, o);
  const totals = sumByCurrency(stripe.flatMap((a) => a.daily.map((d) => ({ currency: d.currency, amount: d.gross }))));
  const currency = totals[0]?.currency ?? "usd";
  const byDay = new Map<string, number>();
  for (const a of stripe) for (const d of a.daily) if (d.currency === currency) byDay.set(d.date, (byDay.get(d.date) ?? 0) + d.gross);
  const days = Array.from({ length: 30 }, (_, i) => {
    const t = new Date(Date.parse(`${today}T00:00:00Z`) - (29 - i) * 86_400_000).toISOString().slice(0, 10);
    return { date: t, amount: byDay.get(t) ?? 0 };
  });
  return { currency, days, otherCurrencies: totals.slice(1).map((t) => t.currency) };
}
