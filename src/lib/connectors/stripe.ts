import { demoStripe } from "../demo";
import { today } from "../dates";
import { toMonthly, type Interval } from "../money";
import { stripeAccounts, type StripeAccount } from "../server/credentials";
import { errorMessage, fromSource, getJson } from "../source";
import type { StripeAccountSummary } from "../types";

const API = "https://api.stripe.com/v1";
const DAY = 86_400_000;
const MAX_PAGES = 10; // 1,000 rows per list is plenty for a monthly view

interface List<T> {
  data: T[];
  has_more: boolean;
}

async function listAll<T extends { id: string }>(key: string, path: string, params: Record<string, string>): Promise<{ rows: T[]; truncated: boolean }> {
  const rows: T[] = [];
  let after: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const q = new URLSearchParams({ limit: "100", ...params, ...(after ? { starting_after: after } : {}) });
    const res = await getJson<List<T>>(`${API}${path}?${q}`, { headers: { Authorization: `Bearer ${key}` } });
    rows.push(...res.data);
    if (!res.has_more || res.data.length === 0) return { rows, truncated: false };
    after = res.data[res.data.length - 1].id;
  }
  return { rows, truncated: true };
}

interface BalanceTxn {
  id: string;
  amount: number;
  fee: number;
  net: number;
  currency: string;
  type: string;
  created: number;
}

interface StripeSub {
  id: string;
  status: string;
  items: { data: { quantity?: number; price: { unit_amount: number | null; currency: string; recurring: { interval: Interval; interval_count: number } | null } }[] };
}

interface Dispute {
  id: string;
  amount: number;
  currency: string;
  reason: string;
  status: string;
  created: number;
  evidence_details?: { due_by: number | null };
}

interface Invoice {
  id: string;
  number: string | null;
  amount_remaining: number;
  currency: string;
  due_date: number | null;
  customer_name: string | null;
  customer_email: string | null;
  hosted_invoice_url: string | null;
}


/** Pure: turns raw Stripe lists into the account summary (tested directly). */
export function summarize(
  account: Pick<StripeAccount, "id" | "business">,
  livemode: boolean,
  balance: { available: { amount: number; currency: string }[]; pending: { amount: number; currency: string }[] },
  txns: BalanceTxn[],
  subs: StripeSub[],
  disputes: Dispute[],
  invoices: Invoice[],
  truncated: boolean,
  timeZone?: string,
): StripeAccountSummary {
  const bal = new Map<string, { currency: string; available: number; pending: number }>();
  for (const b of balance.available) bal.set(b.currency, { currency: b.currency, available: b.amount, pending: 0 });
  for (const b of balance.pending) bal.set(b.currency, { ...(bal.get(b.currency) ?? { currency: b.currency, available: 0 }), pending: b.amount });

  // Money in = charges/payments; refunds and disputes reduce it. Payouts,
  // transfers and topups move money around and are not revenue.
  const revenue = new Map<string, { currency: string; gross: number; refunds: number; fees: number; net: number }>();
  const daily = new Map<string, { date: string; currency: string; gross: number }>();
  for (const t of txns) {
    const income = t.type === "charge" || t.type === "payment";
    const refund = t.type === "refund" || t.type === "payment_refund" || t.type === "adjustment";
    if (!income && !refund) continue;
    const r = revenue.get(t.currency) ?? { currency: t.currency, gross: 0, refunds: 0, fees: 0, net: 0 };
    if (income) r.gross += t.amount;
    else r.refunds += -t.amount;
    r.fees += t.fee;
    r.net += t.net;
    revenue.set(t.currency, r);
    if (income) {
      // Bucketed by the business's calendar day, like the chart's axis (today()).
      const date = today(timeZone, new Date(t.created * 1000));
      const k = `${date}|${t.currency}`;
      const d = daily.get(k) ?? { date, currency: t.currency, gross: 0 };
      d.gross += t.amount;
      daily.set(k, d);
    }
  }

  const mrr = new Map<string, number>();
  let active = 0;
  let pastDue = 0;
  for (const s of subs) {
    if (s.status === "past_due") pastDue++;
    if (s.status !== "active" && s.status !== "past_due") continue;
    if (s.status === "active") active++;
    for (const item of s.items.data) {
      const p = item.price;
      if (!p.recurring || p.unit_amount == null) continue;
      const monthly = toMonthly(p.unit_amount * (item.quantity ?? 1), p.recurring.interval, p.recurring.interval_count);
      mrr.set(p.currency, (mrr.get(p.currency) ?? 0) + monthly);
    }
  }

  return {
    id: account.id,
    business: account.business,
    livemode,
    balance: [...bal.values()],
    revenue: [...revenue.values()].sort((a, b) => b.gross - a.gross),
    daily: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)),
    mrr: [...mrr].map(([currency, amount]) => ({ currency, amount: Math.round(amount) })).sort((a, b) => b.amount - a.amount),
    activeSubscriptions: active,
    pastDueSubscriptions: pastDue,
    disputes: disputes
      .filter((d) => d.status === "needs_response" || d.status === "warning_needs_response" || d.status === "under_review" || d.status === "warning_under_review")
      .map((d) => ({ id: d.id, amount: d.amount, currency: d.currency, reason: d.reason, status: d.status, dueBy: d.evidence_details?.due_by ? new Date(d.evidence_details.due_by * 1000).toISOString() : null, created: new Date(d.created * 1000).toISOString() })),
    openInvoices: invoices
      .filter((i) => i.amount_remaining > 0)
      .map((i) => ({ id: i.id, source: "stripe" as const, business: account.business, client: i.customer_name ?? i.customer_email ?? "Unknown customer", number: i.number, amount: i.amount_remaining, currency: i.currency, dueOn: i.due_date ? today(timeZone, new Date(i.due_date * 1000)) : null, url: i.hosted_invoice_url ?? undefined })),
    truncated,
  };
}

// Rounded down to the hour so the URL (the fetch cache key) stays the same
// between page views and the cached response is reused.
export const sinceHour = (daysAgo: number, now = Date.now()) => String(Math.floor((now - daysAgo * DAY) / 3_600_000) * 3600);

async function fetchAccount(a: StripeAccount): Promise<StripeAccountSummary> {
  const since = sinceHour(30);
  const auth = { headers: { Authorization: `Bearer ${a.key}` } };
  const [balance, txns, active, pastDue, disputes, invoices] = await Promise.all([
    getJson<{ livemode: boolean; available: { amount: number; currency: string }[]; pending: { amount: number; currency: string }[] }>(`${API}/balance`, auth),
    listAll<BalanceTxn>(a.key, "/balance_transactions", { "created[gte]": since }),
    listAll<StripeSub>(a.key, "/subscriptions", { status: "active" }),
    listAll<StripeSub>(a.key, "/subscriptions", { status: "past_due" }),
    // Disputes are listed newest first; anything still open is recent enough.
    listAll<Dispute>(a.key, "/disputes", { "created[gte]": sinceHour(180) }),
    listAll<Invoice>(a.key, "/invoices", { status: "open" }),
  ]);
  const truncated = [txns, active, pastDue, disputes, invoices].some((l) => l.truncated);
  return summarize(a, balance.livemode, balance, txns.rows, [...active.rows, ...pastDue.rows], disputes.rows, invoices.rows, truncated);
}

export async function getStripe() {
  const accounts = await stripeAccounts();
  return fromSource<StripeAccountSummary[]>(
    "Stripe",
    accounts.length > 0,
    async (fail) => {
      // One broken key shouldn't hide the other businesses.
      const settled = await Promise.allSettled(accounts.map(fetchAccount));
      const ok = settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
      settled.forEach((r, i) => r.status === "rejected" && fail(accounts[i].id, `${accounts[i].business}: ${errorMessage(r.reason)}`));
      if (ok.length === 0) throw (settled[0] as PromiseRejectedResult).reason;
      return ok;
    },
    demoStripe,
  );
}
