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
  /** What one month costs on average, per currency (never converted); yearly = 12 × this. */
  amounts: CurrencyAmount[];
  /** Where the figure comes from, e.g. "avg Nov 2025 – Oct 2026" or "last 30 days". */
  basis: string;
  byBusiness: { business: string | null; currency: string; amount: number }[];
}

const monthLabel = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", year: "numeric" });
const monthIdx = (ym: string) => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1;
const idxMonth = (i: number) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;

/** The last month that's over (before today's month), among those with data. */
export function lastCompleteMonth(months: string[], today: string): string | null {
  const current = today.slice(0, 7);
  const done = [...new Set(months)].filter((m) => m < current).sort();
  return done.at(-1) ?? null;
}

/** How many months a billing period covers (an annual plan billed once = 12). At least 1. */
export function periodMonths(start: string | null | undefined, end: string | null | undefined): number {
  if (!start || !end) return 1;
  const days = (Date.parse(`${end.slice(0, 10)}T00:00:00Z`) - Date.parse(`${start.slice(0, 10)}T00:00:00Z`)) / 86_400_000 + 1;
  return Number.isFinite(days) && days > 0 ? Math.max(1, Math.min(36, Math.round(days / 30.44))) : 1;
}

export interface Charge {
  /** YYYY-MM the charge is dated (invoice date / usage month). */
  month: string;
  amount: number;
  currency: string;
  business: string | null;
  /** Months the charge pays for: 1 for monthly bills and usage, 12 for an annual plan. */
  periodMonths: number;
}

/**
 * A monthly equivalent over the trailing 12 months, so an annual charge is
 * never counted as one month's cost. Each charge is spread over the months it
 * pays for (only the part inside the window counts) and the sum is divided by
 * the months observed (from the first charge in the window). `discrete`
 * sources (invoices) may count the current month once its bill exists; usage
 * sources only count complete months.
 */
export function monthlyEquivalent(vendor: ApiVendor, charges: Charge[], today: string, discrete: boolean): ApiSpend | null {
  const cur = monthIdx(today.slice(0, 7));
  const valid = charges.filter((c) => /^\d{4}-\d{2}/.test(c.month) && c.amount !== 0);
  if (!valid.length) return null;
  const latest = Math.max(...valid.map((c) => monthIdx(c.month)));
  const end = discrete && latest >= cur ? cur : cur - 1;
  const inWin = valid.filter((c) => monthIdx(c.month) <= end && monthIdx(c.month) > end - 12);
  if (!inWin.length) return null;
  const first = Math.min(...inWin.map((c) => monthIdx(c.month)));
  const observed = end - first + 1;
  const per = new Map<string, { business: string | null; currency: string; amount: number }>();
  for (const c of inWin) {
    const p = Math.max(1, Math.round(c.periodMonths || 1));
    const share = (c.amount * Math.min(p, end - monthIdx(c.month) + 1)) / p;
    const k = `${c.business ?? ""}\u0000${c.currency}`;
    const prev = per.get(k) ?? { business: c.business, currency: c.currency, amount: 0 };
    prev.amount += share;
    per.set(k, prev);
  }
  const byBusiness = [...per.values()].map((x) => ({ ...x, amount: Math.round(x.amount / observed) })).filter((x) => x.amount !== 0);
  const amounts = sumByCurrency(byBusiness.map((x) => ({ currency: x.currency, amount: x.amount })));
  if (!amounts.length) return null;
  const spread = inWin.some((c) => c.periodMonths > 1);
  const basis = `${observed === 1 ? monthLabel(idxMonth(end)) : `avg ${monthLabel(idxMonth(first))} – ${monthLabel(idxMonth(end))}`}${spread ? " · annual charges ÷ 12" : ""}`;
  return { vendor, name: API_VENDORS[vendor], amounts, basis, byBusiness };
}

/**
 * Each billing API's monthly equivalent (trailing 12 months): Microsoft
 * invoices spread over their billing periods, Google Cloud and usage-based
 * platforms over complete months, Stripe fees over the last 30 days. Only
 * sources whose mode is live count.
 */
export function apiSpend(b: Bills, stripe: StripeAccountSummary[], today: string, live: { microsoft: boolean; google: boolean; platforms: boolean; stripe: boolean }): ApiSpend[] {
  const out: ApiSpend[] = [];
  const push = (x: ApiSpend | null) => x && out.push(x);
  if (live.microsoft) {
    const inv = b.microsoft.billing.invoices.filter((i) => i.totalMinor !== null && i.currency && i.date && i.status !== "void");
    push(monthlyEquivalent("microsoft", inv.map((i) => ({ month: i.date!.slice(0, 7), amount: i.totalMinor!, currency: i.currency!, business: i.business, periodMonths: periodMonths(i.periodStart, i.periodEnd) })), today, true));
  }
  if (live.google) {
    push(monthlyEquivalent("google-cloud", b.google.costs.map((r) => ({ month: r.month, amount: r.netMinor, currency: r.currency, business: r.business, periodMonths: 1 })), today, false));
  }
  if (live.platforms) {
    for (const p of b.platforms) {
      if (p.status !== "ok" || !isApiVendor(p.platform)) continue;
      // Cloudflare's history lists invoices; the others report usage that accrues through the month.
      push(monthlyEquivalent(p.platform, p.charges.map((c) => ({ month: c.date.slice(0, 7), amount: c.amountMinor, currency: c.currency, business: c.business, periodMonths: c.periodMonths ?? 1 })), today, p.platform === "cloudflare"));
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

/** One business's share of a billing API's monthly figure. */
export interface ApiSlice {
  vendor: ApiVendor;
  name: string;
  business: string | null;
  currency: string;
  amount: number;
}

export interface VendorResolution {
  vendor: ApiVendor;
  name: string;
  /** Your entries for this vendor that cover the same business as an API amount. */
  hasManual: boolean;
  choice: SpendChoice;
  /** Businesses where your entry and the API overlap (null = unassigned). */
  overlap: (string | null)[];
  /** API amounts that count. */
  counted: CurrencyAmount[];
  /** API amounts left out because your entry is used for that business. */
  leftOutApi: CurrencyAmount[];
  /** Your entries left out because the billing API is used for their business. */
  leftOutEntries: { id: string; vendor: string; business: string | null }[];
}

export interface SpendResolution {
  /** API amounts (per business) that count in the totals. */
  included: ApiSlice[];
  /** Manual entries left out because the owner chose the billing API for their vendor and business. */
  excludedSubIds: Set<string>;
  vendors: VendorResolution[];
}

/** An entry or an API amount without a business could be any business's, so it overlaps every one. */
const sameBusiness = (a: string | null, b: string | null) => a === null || b === null || a === b;

/**
 * The no-double-count rule, per vendor AND business. An API amount for a
 * business counts unless you have an active entry for the same vendor and
 * business; then your entry counts, unless you picked "Use billing API" for
 * that vendor: then the API counts and those overlapping entries don't. API
 * amounts for businesses your entries don't cover always count.
 */
export function resolveSpend(subs: Sub[], api: ApiSpend[], choices: SpendChoices): SpendResolution {
  const excluded = new Set<string>();
  const included: ApiSlice[] = [];
  const vendors: VendorResolution[] = [];
  for (const a of api) {
    const manual = subs.filter((s) => s.active && vendorKey(s.vendor) === a.vendor);
    const slices = a.byBusiness.map((x) => ({ vendor: a.vendor, name: a.name, business: x.business, currency: x.currency, amount: x.amount }));
    const overlapped = (sl: ApiSlice) => manual.some((s) => sameBusiness(s.business, sl.business));
    const overlapEntries = manual.filter((s) => slices.some((sl) => sameBusiness(s.business, sl.business)));
    const hasManual = overlapEntries.length > 0;
    const choice: SpendChoice = hasManual ? (choices[a.vendor] ?? "manual") : "api";
    const counted = choice === "api" ? slices : slices.filter((sl) => !overlapped(sl));
    included.push(...counted);
    if (choice === "api") for (const s of overlapEntries) excluded.add(s.id);
    vendors.push({
      vendor: a.vendor,
      name: a.name,
      hasManual,
      choice,
      overlap: [...new Set(slices.filter(overlapped).map((sl) => sl.business))],
      counted: sumByCurrency(counted.map((sl) => ({ currency: sl.currency, amount: sl.amount }))),
      leftOutApi: choice === "api" ? [] : sumByCurrency(slices.filter(overlapped).map((sl) => ({ currency: sl.currency, amount: sl.amount }))),
      leftOutEntries: choice === "api" ? overlapEntries.map((s) => ({ id: s.id, vendor: s.vendor, business: s.business })) : [],
    });
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

/** Every line that makes up the monthly total: manual entries (minus overridden ones) plus included API amounts. */
export function monthlyLines(subs: Sub[], r: SpendResolution): MonthlyLine[] {
  const manual = subs
    .filter((s) => s.active && !r.excludedSubIds.has(s.id))
    .map((s) => ({ id: s.id, vendor: s.vendor, business: s.business, monthly: Math.round(toMonthly(s.amountMinor, s.interval)), currency: s.currency, source: "manual" as const }));
  const api = new Map<string, MonthlyLine>();
  for (const sl of r.included) {
    const k = `${sl.vendor}:${sl.business ?? ""}:${sl.currency}`;
    const prev = api.get(k);
    api.set(k, { id: `api:${k}`, vendor: sl.name, business: sl.business, monthly: (prev?.monthly ?? 0) + sl.amount, currency: sl.currency, source: "api" });
  }
  return [...manual, ...[...api.values()].filter((l) => l.monthly !== 0)];
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
  pending: [],
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
    pending: b.pending ?? [],
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
