import { addDays, addMonths, daysBetween, rollForward } from "@/lib/dates";
import { sumByCurrency, toMonthly, type CurrencyAmount } from "@/lib/money";
import type { Severity } from "@/lib/types";
import type { Subscription } from "@/lib/server/store/ledger";

// Pure roll-ups for the Platform spend page. Currencies are never converted:
// every total is a list of per-currency amounts, largest first.

type Sub = Pick<Subscription, "id" | "vendor" | "plan" | "business" | "amountMinor" | "currency" | "interval" | "nextRenewal" | "autoRenew" | "active"> & Partial<Pick<Subscription, "createdOn" | "updatedOn">>;

/** What a subscription costs per month (a yearly plan spread over 12 months). */
export const monthlyOf = (s: Pick<Sub, "amountMinor" | "interval">) => Math.round(toMonthly(s.amountMinor, s.interval));

/** What a subscription costs per year at today's price. */
export const yearlyOf = (s: Pick<Sub, "amountMinor" | "interval">) => (s.interval === "year" ? s.amountMinor : s.amountMinor * 12);

const sorted = (t: CurrencyAmount[]) => [...t].sort((a, b) => b.amount - a.amount);

export function spendTotals(subs: Sub[]) {
  const active = subs.filter((s) => s.active);
  return {
    monthly: sorted(sumByCurrency(active.map((s) => ({ currency: s.currency, amount: monthlyOf(s) })))),
    yearly: sorted(sumByCurrency(active.map((s) => ({ currency: s.currency, amount: yearlyOf(s) })))),
    count: active.length,
    paid: active.filter((s) => s.amountMinor > 0).length,
  };
}

/** The next date it charges (or, with auto-renew off, ends). Null when no date is known. */
export function nextDate(s: Pick<Sub, "nextRenewal" | "autoRenew" | "interval">, today: string): string | null {
  if (!s.nextRenewal) return null;
  return s.autoRenew ? rollForward(s.nextRenewal, s.interval, today) : s.nextRenewal;
}

export interface Renewal {
  id: string;
  vendor: string;
  plan: string | null;
  business: string | null;
  date: string;
  /** Days from today. */
  days: number;
  /** The full charge on that date (not the monthly equivalent). */
  amount: number;
  currency: string;
  interval: "month" | "year";
  /** False: the plan ends on that date instead of renewing. */
  autoRenew: boolean;
}

/** Every charge (or expiry) from today through `days` days ahead, soonest first. A monthly plan can appear twice. */
export function renewalsWithin(subs: Sub[], today: string, days = 30): Renewal[] {
  const end = addDays(today, days);
  const out: Renewal[] = [];
  for (const s of subs) {
    if (!s.active || !s.nextRenewal) continue;
    const base = { id: s.id, vendor: s.vendor, plan: s.plan, business: s.business, amount: s.amountMinor, currency: s.currency, interval: s.interval, autoRenew: s.autoRenew };
    if (!s.autoRenew) {
      if (s.nextRenewal >= today && s.nextRenewal <= end) out.push({ ...base, date: s.nextRenewal, days: daysBetween(today, s.nextRenewal) });
      continue;
    }
    const step = s.interval === "month" ? 1 : 12;
    // Anchored on the stored date so month-end clamping doesn't drift.
    let n = 0;
    let date = s.nextRenewal;
    while (date < today && n < 1200) date = addMonths(s.nextRenewal, step * ++n);
    while (date <= end && n < 1200) {
      out.push({ ...base, date, days: daysBetween(today, date) });
      date = addMonths(s.nextRenewal, step * ++n);
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.vendor.localeCompare(b.vendor));
}

export interface SpendProblem {
  id: string;
  vendor: string;
  business: string | null;
  date: string;
  days: number;
  severity: Severity;
}

/**
 * Plans that end soon because auto-renew is off (or already ended), using the
 * same rule as the to-do list: within 14 days is high, past the date critical.
 */
export function spendProblems(subs: Sub[], today: string): SpendProblem[] {
  return subs
    .filter((s) => s.active && !s.autoRenew && s.nextRenewal && daysBetween(today, s.nextRenewal) <= 14)
    .map((s) => {
      const days = daysBetween(today, s.nextRenewal!);
      return { id: s.id, vendor: s.vendor, business: s.business, date: s.nextRenewal!, days, severity: (days < 0 ? "critical" : "high") as Severity };
    })
    .sort((a, b) => a.days - b.days);
}

/** Monthly cost per business ("Unassigned" when none), biggest first by its main currency. */
export function spendByBusiness(subs: Sub[]): { business: string; totals: CurrencyAmount[] }[] {
  const map = new Map<string, CurrencyAmount[]>();
  for (const s of subs) {
    if (!s.active) continue;
    const b = s.business ?? "Unassigned";
    map.set(b, [...(map.get(b) ?? []), { currency: s.currency, amount: monthlyOf(s) }]);
  }
  return [...map]
    .map(([business, items]) => ({ business, totals: sorted(sumByCurrency(items)) }))
    .sort((a, b) => (b.totals[0]?.amount ?? 0) - (a.totals[0]?.amount ?? 0) || a.business.localeCompare(b.business));
}

export interface TrendMonth {
  /** YYYY-MM */
  month: string;
  amount: number;
}

/**
 * An approximate monthly cost per calendar month for one currency, at
 * today's prices: a subscription counts from the month it was added until the
 * month it stopped being tracked. Price changes aren't recorded, so this is
 * not a billing history.
 */
export function spendTrend(subs: Sub[], today: string, currency: string, months = 6): { months: TrendMonth[]; hasHistory: boolean } {
  const thisMonth = `${today.slice(0, 7)}-01`;
  const out: TrendMonth[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const start = addMonths(thisMonth, -i);
    const end = i === 0 ? today : addDays(addMonths(start, 1), -1);
    let amount = 0;
    for (const s of subs) {
      if (s.currency !== currency || !s.createdOn || s.createdOn > end) continue;
      if (!s.active && (!s.updatedOn || s.updatedOn < start)) continue;
      amount += monthlyOf(s);
    }
    out.push({ month: start.slice(0, 7), amount });
  }
  const hasHistory = subs.some((s) => s.currency === currency && !!s.createdOn && s.createdOn < thisMonth);
  return { months: out, hasHistory };
}

/** Subscriptions added, and ones that stopped being tracked, in the last `days` days. */
export function recentChanges(subs: Sub[], today: string, days = 30) {
  const since = addDays(today, -days);
  return {
    added: subs.filter((s) => s.active && s.createdOn && s.createdOn >= since).sort((a, b) => monthlyOf(b) - monthlyOf(a)),
    stopped: subs.filter((s) => !s.active && s.updatedOn && s.updatedOn >= since).sort((a, b) => monthlyOf(b) - monthlyOf(a)),
  };
}

/** Spend as a share of revenue, same currency only. Null when it can't be said honestly. */
export function spendShare(monthly: CurrencyAmount[], revenue30d: CurrencyAmount[]): { pct: number; currency: string; spend: number; revenue: number } | null {
  const main = monthly[0];
  if (!main) return null;
  const rev = revenue30d.find((r) => r.currency === main.currency);
  if (!rev || rev.amount <= 0) return null;
  return { pct: Math.round((main.amount / rev.amount) * 1000) / 10, currency: main.currency, spend: main.amount, revenue: rev.amount };
}
