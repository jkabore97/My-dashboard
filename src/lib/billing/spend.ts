import { canSee, inBusiness, isFullOwner, type Access } from "../access";
import { addMonths } from "../dates";
import { sumByCurrency, toMonthly, type CurrencyAmount } from "../money";
import type { Severity, SourceMode, StripeAccountSummary, Task } from "../types";
import type { Subscription } from "../server/store/ledger";
import { vendorKey } from "./email";
import { licenceWaste, M365_ADMIN } from "./microsoft";
import type { Bills, MsAdminData, PlatformBilling } from "./types";

// How automatic bills join the Platform spend totals, who may see them, and
// the tasks they raise. Pure: the spend page, the Overview tile, scoping and
// tests all share these rules.

/** Vendors whose cost a billing API reports. Keys match vendorKey(). */
export const API_VENDORS = {
  microsoft: "Microsoft 365 / Azure",
  "google-cloud": "Google Cloud",
  cloudflare: "Cloudflare",
  github: "GitHub",
  vercel: "Vercel",
  anthropic: "Anthropic (Claude API)",
  stripe: "Stripe processing fees",
} as const;
export type ApiVendor = keyof typeof API_VENDORS;
export const isApiVendor = (v: string): v is ApiVendor => v in API_VENDORS;

/** Per vendor: count the billing API's amount, or the owner's own subscription entry. */
export type SpendChoice = "api" | "manual";
export type SpendChoices = Partial<Record<ApiVendor, SpendChoice>>;
export const SPEND_CHOICES_KEY = "spend:sources";

export interface ApiSpend {
  vendor: ApiVendor;
  name: string;
  /** What one month costs, per currency (never converted). */
  amounts: CurrencyAmount[];
  /** Where the figure comes from, e.g. "invoice of Sep 2026" or "last 30 days". */
  basis: string;
  byBusiness: { business: string | null; currency: string; amount: number }[];
}

const monthLabel = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", year: "numeric" });

/** The last month that's over (before today's month), among those with data; the latest one otherwise. */
export function lastCompleteMonth(months: string[], today: string): string | null {
  const current = today.slice(0, 7);
  const done = [...new Set(months)].filter((m) => m < current).sort();
  return done.at(-1) ?? null;
}

function fromRows(vendor: ApiVendor, rows: { month: string; currency: string; amount: number; business: string | null }[], today: string): ApiSpend | null {
  const month = lastCompleteMonth(rows.map((r) => r.month), today);
  if (!month) return null;
  const inMonth = rows.filter((r) => r.month === month);
  const amounts = sumByCurrency(inMonth.map((r) => ({ currency: r.currency, amount: r.amount }))).filter((a) => a.amount !== 0);
  if (!amounts.length) return null;
  return { vendor, name: API_VENDORS[vendor], amounts, basis: monthLabel(month), byBusiness: inMonth.map((r) => ({ business: r.business, currency: r.currency, amount: r.amount })) };
}

/**
 * One month of each billing API's cost: Microsoft's latest invoice month,
 * Google Cloud's and the other platforms' last complete month, Stripe fees
 * over the last 30 days. Only sources whose mode is live count.
 */
export function apiSpend(b: Bills, stripe: StripeAccountSummary[], today: string, live: { microsoft: boolean; google: boolean; platforms: boolean; stripe: boolean }): ApiSpend[] {
  const out: ApiSpend[] = [];
  if (live.microsoft) {
    const inv = b.microsoft.billing.invoices.filter((i) => i.totalMinor !== null && i.currency && i.date && i.status !== "void");
    const latest = inv.map((i) => i.date!.slice(0, 7)).sort().at(-1);
    if (latest) {
      const rows = inv.filter((i) => i.date!.startsWith(latest));
      const amounts = sumByCurrency(rows.map((i) => ({ currency: i.currency!, amount: i.totalMinor! }))).filter((a) => a.amount !== 0);
      if (amounts.length) out.push({ vendor: "microsoft", name: API_VENDORS.microsoft, amounts, basis: `invoice of ${monthLabel(latest)}`, byBusiness: rows.map((i) => ({ business: i.business, currency: i.currency!, amount: i.totalMinor! })) });
    }
  }
  if (live.google) {
    const g = fromRows("google-cloud", b.google.costs.map((r) => ({ month: r.month, currency: r.currency, amount: r.netMinor, business: r.business })), today);
    if (g) out.push(g);
  }
  if (live.platforms) {
    for (const p of b.platforms) {
      if (p.status !== "ok" || !isApiVendor(p.platform)) continue;
      const s = fromRows(p.platform, p.charges.map((c) => ({ month: c.date.slice(0, 7), currency: c.currency, amount: c.amountMinor, business: c.business })), today);
      if (s) out.push(s);
    }
  }
  if (live.stripe) {
    const fees = stripe.filter((a) => a.livemode && !a.sample).flatMap((a) => a.revenue.filter((r) => r.fees > 0).map((r) => ({ business: a.business as string | null, currency: r.currency, amount: r.fees })));
    const amounts = sumByCurrency(fees);
    if (amounts.length) out.push({ vendor: "stripe", name: API_VENDORS.stripe, amounts, basis: "last 30 days", byBusiness: fees });
  }
  return out;
}

type Sub = Pick<Subscription, "id" | "vendor" | "business" | "amountMinor" | "currency" | "interval" | "active">;

export interface SpendResolution {
  /** API figures that count in the totals. */
  included: ApiSpend[];
  /** Manual entries left out because the owner chose the billing API for their vendor. */
  excludedSubIds: Set<string>;
  vendors: { vendor: ApiVendor; name: string; hasManual: boolean; choice: SpendChoice; included: boolean }[];
}

/**
 * The no-double-count rule. A billing API's amount counts only when there's
 * no active manual subscription for the same vendor, unless the owner picked
 * "Use billing API" for it: then the API counts and those entries don't.
 */
export function resolveSpend(subs: Sub[], api: ApiSpend[], choices: SpendChoices): SpendResolution {
  const excluded = new Set<string>();
  const included: ApiSpend[] = [];
  const vendors: SpendResolution["vendors"] = [];
  for (const a of api) {
    const manual = subs.filter((s) => s.active && vendorKey(s.vendor) === a.vendor);
    const choice: SpendChoice = manual.length ? (choices[a.vendor] ?? "manual") : "api";
    const use = choice === "api";
    if (use) {
      included.push(a);
      for (const s of manual) excluded.add(s.id);
    }
    vendors.push({ vendor: a.vendor, name: a.name, hasManual: manual.length > 0, choice, included: use });
  }
  return { included, excludedSubIds: excluded, vendors };
}

export interface MonthlyLine {
  id: string;
  vendor: string;
  business: string | null;
  monthly: number;
  currency: string;
  source: "manual" | "api";
}

/** Every line that makes up the monthly total: manual entries (minus overridden ones) plus included API figures. */
export function monthlyLines(subs: Sub[], r: SpendResolution): MonthlyLine[] {
  const manual = subs
    .filter((s) => s.active && !r.excludedSubIds.has(s.id))
    .map((s) => ({ id: s.id, vendor: s.vendor, business: s.business, monthly: Math.round(toMonthly(s.amountMinor, s.interval)), currency: s.currency, source: "manual" as const }));
  const api = r.included.flatMap((a) => {
    const per = new Map<string, MonthlyLine>();
    for (const x of a.byBusiness) {
      const k = `${x.business ?? ""}:${x.currency}`;
      const prev = per.get(k);
      per.set(k, { id: `api:${a.vendor}:${k}`, vendor: a.name, business: x.business, monthly: (prev?.monthly ?? 0) + x.amount, currency: x.currency, source: "api" });
    }
    return [...per.values()].filter((l) => l.monthly !== 0);
  });
  return [...manual, ...api];
}

export const monthlyTotal = (lines: MonthlyLine[]) => sumByCurrency(lines.map((l) => ({ currency: l.currency, amount: l.monthly })));

/** Total monthly spend (manual + billing APIs) for the Spend page and the Overview tile. */
export function combinedSpend(d: { records: { subscriptions: Sub[] }; bills?: Bills; stripe: StripeAccountSummary[]; modes?: Record<string, SourceMode>; spendChoices?: SpendChoices }, today: string) {
  const live = (k: string) => d.modes?.[k] === "live";
  const api = d.bills ? apiSpend(d.bills, d.stripe, today, { microsoft: live("msadmin"), google: live("gcloud"), platforms: live("billing"), stripe: live("stripe") }) : [];
  const resolution = resolveSpend(d.records.subscriptions, api, d.spendChoices ?? {});
  const lines = monthlyLines(d.records.subscriptions, resolution);
  return { api, resolution, lines, monthly: monthlyTotal(lines) };
}

// ─── Who sees what ───────────────────────────────────────────────────────────

export const emptyBills = (): Bills => ({
  microsoft: { tenant: null, account: null, licences: [], health: [], billing: { accounts: [], invoices: [], subscriptions: [], error: null, checkedAt: null } },
  google: { serviceAccount: null, billingAccounts: [], projects: [], costs: [], export: { table: null, status: null, error: null, checkedAt: null } },
  platforms: [],
  email: [],
});

/**
 * Billing is part of Money; per-business rows only where a project, invoice
 * or mailbox maps to a business the person has. Anything unmapped (tenant
 * licences, billing accounts, account-level charges) and platform admin
 * data (service health, setup errors) is for full owners only.
 */
export function scopeBills(b: Bills, a: Access): Bills {
  if (isFullOwner(a)) return b;
  const e = emptyBills();
  if (!canSee(a, "money")) return e;
  const mine = (x: string | null | undefined) => !!x && inBusiness(a, x);
  return {
    microsoft: { ...e.microsoft, billing: { ...e.microsoft.billing, invoices: b.microsoft.billing.invoices.filter((i) => mine(i.business)), subscriptions: b.microsoft.billing.subscriptions.filter((s) => mine(s.business)), checkedAt: b.microsoft.billing.checkedAt } },
    google: { ...e.google, projects: b.google.projects.filter((p) => mine(p.business)), costs: b.google.costs.filter((c) => mine(c.business)), export: { ...e.google.export, status: b.google.export.status, checkedAt: b.google.export.checkedAt } },
    platforms: b.platforms.map((p): PlatformBilling => ({ ...p, message: null, plan: null, charges: p.charges.filter((c) => mine(c.business)) })),
    email: b.email.filter((x) => mine(x.business)),
  };
}

// ─── Tasks ───────────────────────────────────────────────────────────────────

export type BillingScope = "msadmin" | "msbilling";

export interface BillingTask extends Task {
  scope: BillingScope;
  live: boolean;
}

/**
 * Microsoft 365 admin → tasks: open service incidents, paid licences nobody
 * uses (low), overdue invoices (high). Keys are stable per SKU / issue /
 * invoice so state survives refreshes.
 */
export function deriveBillingTasks(input: { microsoft: MsAdminData; modes: { msadmin: SourceMode; msbilling: SourceMode }; now?: string }): BillingTask[] {
  const now = input.now ?? new Date().toISOString();
  const tasks: BillingTask[] = [];
  const add = (scope: BillingScope, key: string, t: Omit<Task, "id">) => tasks.push({ ...t, id: `${scope}/${key}`, scope, live: input.modes[scope] === "live" });
  const m = input.microsoft;
  for (const l of licenceWaste(m.licences)) {
    add("msadmin", `licences:${l.sku}`, {
      title: `${l.unassigned} unassigned ${l.name} licence${l.unassigned === 1 ? "" : "s"}`,
      detail: `${l.purchased} purchased, ${l.assigned} assigned. Assign them, or lower the seat count before the next renewal.`,
      severity: "low",
      source: "Microsoft 365 admin",
      url: `${M365_ADMIN}#/licenses`,
      createdAt: now,
    });
  }
  for (const h of m.health) {
    if (h.classification !== "incident" && h.severity === "low") continue;
    add("msadmin", `health:${h.id}`, { title: `${h.service}: ${h.title}`, detail: h.impact ?? `Status: ${h.status}`, severity: h.severity as Severity, source: "Microsoft 365 service health", url: h.url, createdAt: h.startedAt ?? now });
  }
  for (const i of m.billing.invoices) {
    if (i.status !== "overdue") continue;
    add("msbilling", `invoice:${i.id}`, { title: `Microsoft invoice ${i.number} is overdue`, detail: i.dueDate ? `Was due ${i.dueDate}` : undefined, severity: "high", source: "Microsoft billing", url: i.url, createdAt: i.dueDate ? `${i.dueDate}T00:00:00.000Z` : now, ...(i.business ? { business: i.business } : {}) });
  }
  return tasks;
}

/** Keys not checked this round (part of the source failed): their tasks stay as they are. */
export function billingUnobserved(partial: { key: string }[] | undefined, billingError: string | null | undefined): string[] {
  const keys = (partial ?? []).map((p) => p.key);
  return [...(keys.includes("licences") ? ["msadmin/licences:"] : []), ...(keys.includes("health") ? ["msadmin/health:"] : []), ...(billingError ? ["msbilling/"] : [])];
}

/** Months covered by the Google cost window, oldest first (for the per-month view). */
export function recentMonths(today: string, n = 6): string[] {
  const first = `${today.slice(0, 7)}-01`;
  return Array.from({ length: n }, (_, i) => addMonths(first, i - (n - 1)).slice(0, 7));
}
