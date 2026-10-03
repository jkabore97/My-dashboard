import { minorUnits } from "../money";
import type { PlatformCharge } from "./types";

// Pure parsers for other platforms' billing / usage APIs. Each turns a
// recorded response shape into charges in minor units; the fetching (and
// the fail-soft status per platform) lives in connectors/platform-billing.ts.

const toMinor = (value: number, currency: string) => Math.round(value * minorUnits(currency));
const ymd = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

// ─── Cloudflare ──────────────────────────────────────────────────────────────

interface CfBillingItem {
  id?: string;
  type?: string;
  action?: string;
  description?: string;
  occurred_at?: string;
  amount?: number;
  currency?: string;
  zone?: { name?: string };
}

/** GET /user/billing/history → charges (refunds negative). */
export function parseCloudflareHistory(items: CfBillingItem[] | undefined, businessOf: (name: string) => string | null = () => null): PlatformCharge[] {
  return (items ?? []).flatMap((i) => {
    const date = ymd(i.occurred_at);
    const currency = (i.currency ?? "").toLowerCase();
    const amount = Number(i.amount);
    if (!date || !/^[a-z]{3}$/.test(currency) || !Number.isFinite(amount) || amount === 0) return [];
    const sign = i.type === "refund" ? -1 : 1;
    const zone = i.zone?.name ?? null;
    return [{ id: `cf:${i.id ?? `${date}:${amount}`}`, date, description: [i.description || i.action || "Cloudflare charge", zone].filter(Boolean).join(" · "), amountMinor: sign * toMinor(Math.abs(amount), currency), currency, business: zone ? businessOf(zone) : null }];
  });
}

interface CfSubscription {
  id?: string;
  price?: number;
  currency?: string;
  frequency?: string;
  state?: string;
  rate_plan?: { public_name?: string; id?: string };
  product?: { name?: string };
  zone?: { name?: string };
}

/** GET /accounts/{id}/subscriptions → plan names with their price (paid ones first). */
export function parseCloudflareSubscriptions(subs: CfSubscription[] | undefined): { name: string; amountMinor: number; currency: string; frequency: string }[] {
  return (subs ?? [])
    .filter((s) => s.state !== "Cancelled" && s.state !== "Expired")
    .map((s) => {
      const currency = (s.currency ?? "usd").toLowerCase();
      return { name: [s.rate_plan?.public_name ?? s.product?.name ?? "Subscription", s.zone?.name].filter(Boolean).join(" · "), amountMinor: toMinor(Number(s.price) || 0, currency), currency, frequency: s.frequency ?? "monthly" };
    })
    .sort((a, b) => b.amountMinor - a.amountMinor);
}

// ─── GitHub (enhanced billing usage) ─────────────────────────────────────────

interface GhUsageItem {
  date?: string;
  product?: string;
  sku?: string;
  netAmount?: number;
  grossAmount?: number;
  organizationName?: string;
  repositoryName?: string;
}

const GH_PRODUCT: Record<string, string> = { actions: "Actions", copilot: "Copilot", packages: "Packages", git_lfs: "Git LFS", codespaces: "Codespaces", shared_storage: "Storage" };

/** usageItems → one charge per month and product (net of discounts; included free usage nets to zero and is dropped). */
export function parseGithubUsage(items: GhUsageItem[] | undefined, scope: string, businessOf: (name: string) => string | null = () => null): PlatformCharge[] {
  const by = new Map<string, PlatformCharge>();
  for (const i of items ?? []) {
    const date = ymd(i.date);
    const net = Number(i.netAmount ?? 0);
    if (!date || !Number.isFinite(net)) continue;
    const month = date.slice(0, 7);
    const product = GH_PRODUCT[(i.product ?? "").toLowerCase()] ?? i.product ?? "Usage";
    const key = `${month}:${product}`;
    const prev = by.get(key);
    const org = i.organizationName ?? null;
    by.set(key, { id: `gh:${scope}:${key}`, date: `${month}-01`, description: `${product}${scope ? ` · ${scope}` : ""}`, amountMinor: (prev?.amountMinor ?? 0) + toMinor(net, "usd"), currency: "usd", business: prev?.business ?? (org ? businessOf(org) : businessOf(scope)) });
  }
  return [...by.values()].filter((c) => c.amountMinor !== 0).sort((a, b) => b.date.localeCompare(a.date) || a.description.localeCompare(b.description));
}

// ─── Vercel (FOCUS charges, JSON lines) ──────────────────────────────────────

/** GET /v1/billing/charges returns FOCUS 1.x rows as newline-delimited JSON. Grouped per month and service. */
export function parseVercelCharges(body: string, businessOf: (name: string) => string | null = () => null): PlatformCharge[] {
  const by = new Map<string, PlatformCharge>();
  for (const line of body.split("\n")) {
    if (!line.trim()) continue;
    let r: Record<string, unknown>;
    try {
      r = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const date = ymd(r.ChargePeriodStart ?? r.BillingPeriodStart);
    const currency = String(r.BillingCurrency ?? "USD").toLowerCase();
    const cost = Number(r.BilledCost ?? r.EffectiveCost ?? 0);
    if (!date || !/^[a-z]{3}$/.test(currency) || !Number.isFinite(cost) || cost === 0) continue;
    const month = date.slice(0, 7);
    const service = String(r.ServiceName ?? r.ChargeDescription ?? "Vercel");
    const project = typeof r.Tags === "object" && r.Tags ? String((r.Tags as Record<string, unknown>).ProjectName ?? "") : "";
    const key = `${month}:${service}:${currency}`;
    const prev = by.get(key);
    by.set(key, { id: `vercel:${key}`, date: `${month}-01`, description: service, amountMinor: (prev?.amountMinor ?? 0) + toMinor(cost, currency), currency, business: prev?.business ?? (project ? businessOf(project) : null) });
  }
  return [...by.values()].filter((c) => c.amountMinor !== 0).sort((a, b) => b.date.localeCompare(a.date) || b.amountMinor - a.amountMinor);
}

/** A Vercel plan name from /v2/teams/{id} or /v2/user. */
export function vercelPlan(body: { billing?: { plan?: string } | null; user?: { billing?: { plan?: string } | null } } | null | undefined): string | null {
  return body?.billing?.plan ?? body?.user?.billing?.plan ?? null;
}

// ─── Supabase (plan only) ────────────────────────────────────────────────────

/** Organisation plans: Supabase has no public billing-amount API for customers. */
export function supabasePlans(orgs: { name?: string; plan?: string | null }[]): { name: string; plan: string }[] {
  return orgs.filter((o) => o.name).map((o) => ({ name: o.name!, plan: (o.plan ?? "unknown").toLowerCase() }));
}

// ─── Anthropic (Admin API cost report) ───────────────────────────────────────

interface AnthropicCostBucket {
  starting_at?: string;
  results?: { amount?: string | number; currency?: string; description?: string | null }[];
}

/**
 * cost_report buckets (daily) → one charge per month and currency. Amounts
 * are decimal strings in the currency's lowest unit (cents for USD).
 */
export function parseAnthropicCost(buckets: AnthropicCostBucket[] | undefined): PlatformCharge[] {
  const by = new Map<string, PlatformCharge>();
  for (const b of buckets ?? []) {
    const date = ymd(b.starting_at);
    if (!date) continue;
    const month = date.slice(0, 7);
    for (const r of b.results ?? []) {
      const currency = String(r.currency ?? "USD").toLowerCase();
      const cents = Number(r.amount);
      if (!/^[a-z]{3}$/.test(currency) || !Number.isFinite(cents)) continue;
      const key = `${month}:${currency}`;
      const prev = by.get(key);
      by.set(key, { id: `anthropic:${key}`, date: `${month}-01`, description: "Claude API usage", amountMinor: (prev?.amountMinor ?? 0) + cents, currency, business: null });
    }
  }
  return [...by.values()].map((c) => ({ ...c, amountMinor: Math.round(c.amountMinor) })).filter((c) => c.amountMinor !== 0).sort((a, b) => b.date.localeCompare(a.date));
}
