import { addMonths, today as todayFn } from "../dates";
import { parseAnthropicCost, parseCloudflareHistory, parseCloudflareSubscriptions, parseGithubUsage, parseVercelCharges, supabasePlans, vercelPlan } from "../billing/platforms";
import type { PlatformBilling, PlatformBillingId } from "../billing/types";
import { businessFor, type BusinessRule } from "../server/config";
import { callSignal, errorMessage } from "../source";

// Bills from the other connected platforms, wherever they have a billing or
// usage API. Read every six hours; each platform fails on its own and says
// what to change ("add Billing: Read to the Cloudflare token"). Every call
// has a 10 s limit and each platform's whole read is capped (`signal`).

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function call(url: string, headers: Record<string, string>, as: "json" | "text" = "json", signal?: AbortSignal) {
  const res = await fetch(url, { headers: { Accept: "application/json", ...headers }, cache: "no-store", signal: callSignal(10_000, signal) });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new HttpError(res.status, `${res.status} from ${new URL(url).host}${body ? `: ${body.slice(0, 160).replace(/\s+/g, " ")}` : ""}`);
  }
  return as === "json" ? res.json() : res.text();
}

const denied = (err: unknown) => err instanceof HttpError && (err.status === 401 || err.status === 403 || err.status === 404);
const base = (platform: PlatformBillingId, vendor: string): PlatformBilling => ({ platform, vendor, status: null, message: null, plan: null, charges: [], checkedAt: new Date().toISOString() });

export async function cloudflareBilling(creds: { token: string; accountId: string }, rules: BusinessRule[], signal?: AbortSignal): Promise<PlatformBilling> {
  const out = base("cloudflare", "Cloudflare");
  const auth = { Authorization: `Bearer ${creds.token}` };
  let plans: ReturnType<typeof parseCloudflareSubscriptions> = [];
  try {
    plans = parseCloudflareSubscriptions(((await call(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(creds.accountId)}/subscriptions`, auth, "json", signal)) as { result?: [] }).result);
    out.plan = plans.filter((p) => p.amountMinor > 0).map((p) => p.name).slice(0, 3).join(", ") || (plans.length ? "Free" : null);
  } catch {
    /* plan names are a nice-to-have */
  }
  try {
    const r = (await call("https://api.cloudflare.com/client/v4/user/billing/history?per_page=50&order=occurred_at&direction=desc", auth, "json", signal)) as { result?: [] };
    const yearly = plans.filter((p) => /year|annual/i.test(p.frequency)).map((p) => p.name.split(" · ")[0]);
    out.charges = parseCloudflareHistory(r.result, (n) => businessFor(n, rules) ?? null, yearly);
    out.status = out.charges.length || plans.some((p) => p.amountMinor > 0) ? "ok" : "free";
    if (out.status === "free") out.message = "No Cloudflare charges: everything is on free plans.";
  } catch (err) {
    out.status = denied(err) ? "permission" : "error";
    out.message = denied(err) ? "Add \"Billing: Read\" to the Cloudflare API token to read invoices." : `Cloudflare billing failed: ${errorMessage(err)}`;
  }
  return out;
}

export async function githubBilling(token: string, rules: BusinessRule[], today: string, signal?: AbortSignal): Promise<PlatformBilling> {
  const out = base("github", "GitHub");
  const h = { Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "KajCommandCenter" };
  const years = [Number(today.slice(0, 4)), ...(Number(today.slice(5, 7)) <= 6 ? [Number(today.slice(0, 4)) - 1] : [])];
  try {
    const me = (await call("https://api.github.com/user", h, "json", signal)) as { login: string; plan?: { name?: string } };
    out.plan = me.plan?.name ?? null;
    for (const y of years) {
      const r = (await call(`https://api.github.com/users/${encodeURIComponent(me.login)}/settings/billing/usage?year=${y}`, h, "json", signal)) as { usageItems?: [] };
      out.charges.push(...parseGithubUsage(r.usageItems, me.login, (n) => businessFor(n, rules) ?? null));
    }
    const orgs = ((await call("https://api.github.com/user/orgs?per_page=10", h, "json", signal).catch(() => [])) as { login: string }[]).slice(0, 3);
    for (const o of orgs) {
      try {
        const r = (await call(`https://api.github.com/organizations/${encodeURIComponent(o.login)}/settings/billing/usage?year=${years[0]}`, h, "json", signal)) as { usageItems?: [] };
        out.charges.push(...parseGithubUsage(r.usageItems, o.login, (n) => businessFor(n, rules) ?? null));
      } catch {
        /* org billing needs an org owner's token */
      }
    }
    out.status = out.charges.length ? "ok" : "free";
    if (!out.charges.length) out.message = "No paid GitHub usage this year (included minutes and storage only).";
  } catch (err) {
    out.status = denied(err) ? "permission" : "error";
    out.message = denied(err) ? "Give the GitHub token the \"Plan: read\" account permission (fine-grained token) to read billing usage." : `GitHub billing failed: ${errorMessage(err)}`;
  }
  return out;
}

export async function vercelBilling(creds: { token: string; teamId: string | null }, rules: BusinessRule[], today: string, signal?: AbortSignal): Promise<PlatformBilling> {
  const out = base("vercel", "Vercel");
  const h = { Authorization: `Bearer ${creds.token}` };
  const team = creds.teamId ? `&teamId=${encodeURIComponent(creds.teamId)}` : "";
  try {
    const plan = vercelPlan((await call(creds.teamId ? `https://api.vercel.com/v2/teams/${encodeURIComponent(creds.teamId)}` : "https://api.vercel.com/v2/user", h, "json", signal)) as Parameters<typeof vercelPlan>[0]);
    out.plan = plan;
    if (plan === "hobby") {
      out.status = "free";
      out.message = "Hobby plan: nothing is billed. Marketplace add-ons (e.g. Neon) bill through Vercel once on a paid plan.";
      return out;
    }
  } catch {
    /* plan unknown: try the charges anyway */
  }
  try {
    const from = `${addMonths(`${today.slice(0, 7)}-01`, -5)}T00:00:00.000Z`;
    const body = (await call(`https://api.vercel.com/v1/billing/charges?from=${encodeURIComponent(from)}&to=${encodeURIComponent(new Date().toISOString())}${team}`, { ...h, Accept: "application/jsonl, application/json" }, "text", signal)) as string;
    out.charges = parseVercelCharges(body, (n) => businessFor(n, rules) ?? null);
    out.status = out.charges.length ? "ok" : "free";
    if (!out.charges.length) out.message = "No Vercel charges in the last six months.";
  } catch (err) {
    out.status = denied(err) ? "permission" : "error";
    out.message = denied(err) ? "Vercel billing charges need a Pro/Enterprise team and a token scoped to that team." : `Vercel billing failed: ${errorMessage(err)}`;
  }
  return out;
}

export async function supabaseBilling(token: string, signal?: AbortSignal): Promise<PlatformBilling> {
  const out = base("supabase", "Supabase");
  const h = { Authorization: `Bearer ${token}` };
  try {
    const orgs = ((await call("https://api.supabase.com/v1/organizations", h, "json", signal)) as { id: string; slug?: string; name?: string }[]).slice(0, 5);
    const detail = await Promise.all(orgs.map((o) => call(`https://api.supabase.com/v1/organizations/${encodeURIComponent(o.slug ?? o.id)}`, h, "json", signal).catch(() => ({ name: o.name, plan: null })) as Promise<{ name?: string; plan?: string | null }>));
    const plans = supabasePlans(detail.map((d, i) => ({ name: d.name ?? orgs[i].name, plan: d.plan })));
    out.plan = plans.map((p) => `${p.name}: ${p.plan}`).join(", ") || null;
    const paid = plans.filter((p) => p.plan !== "free");
    out.status = paid.length ? "plan" : "free";
    out.message = paid.length ? "Supabase has no billing-amount API: the amount comes from receipt e-mails or your own entry." : "Every Supabase organization is on the free plan.";
  } catch (err) {
    out.status = "error";
    out.message = `Supabase plan lookup failed: ${errorMessage(err)}`;
  }
  return out;
}

export async function anthropicBilling(adminKey: string, today: string, signal?: AbortSignal): Promise<PlatformBilling> {
  const out = base("anthropic", "Anthropic (Claude API)");
  const h = { "x-api-key": adminKey, "anthropic-version": "2023-06-01" };
  try {
    const start = `${addMonths(`${today.slice(0, 7)}-01`, -2)}T00:00:00Z`;
    const buckets: unknown[] = [];
    let page: string | null = null;
    for (let i = 0; i < 6; i++) {
      const q = new URLSearchParams({ starting_at: start, bucket_width: "1d", limit: "31", ...(page ? { page } : {}) });
      const r = (await call(`https://api.anthropic.com/v1/organizations/cost_report?${q}`, h, "json", signal)) as { data?: unknown[]; has_more?: boolean; next_page?: string | null };
      buckets.push(...(r.data ?? []));
      if (!r.has_more || !r.next_page) break;
      page = r.next_page;
    }
    out.charges = parseAnthropicCost(buckets as Parameters<typeof parseAnthropicCost>[0]);
    out.status = out.charges.length ? "ok" : "free";
    if (!out.charges.length) out.message = "No Claude API cost in the last three months.";
  } catch (err) {
    out.status = denied(err) ? "permission" : "error";
    out.message = denied(err) ? "ANTHROPIC_ADMIN_KEY was rejected: it must be an Admin API key (sk-ant-admin…)." : `Anthropic cost report failed: ${errorMessage(err)}`;
  }
  return out;
}

export function demoPlatformBilling(): PlatformBilling[] {
  const t = todayFn();
  const m = (n: number) => addMonths(`${t.slice(0, 7)}-01`, -n);
  const at = new Date().toISOString();
  return [
    { platform: "cloudflare", vendor: "Cloudflare", status: "ok", message: null, plan: "Workers Paid", checkedAt: at, charges: [1, 2, 3].map((n) => ({ id: `cf:demo${n}`, date: m(n), description: "Workers Paid", amountMinor: 500, currency: "usd", business: "Kaj Bookings" })) },
    { platform: "github", vendor: "GitHub", status: "ok", message: null, plan: "pro", checkedAt: at, charges: [1, 2].map((n) => ({ id: `gh:demo${n}`, date: m(n), description: "Copilot · kaj", amountMinor: 1000, currency: "usd", business: "Kaj Consulting" })) },
    { platform: "vercel", vendor: "Vercel", status: "free", message: "Hobby plan: nothing is billed. Marketplace add-ons (e.g. Neon) bill through Vercel once on a paid plan.", plan: "hobby", checkedAt: at, charges: [] },
    { platform: "supabase", vendor: "Supabase", status: "plan", message: "Supabase has no billing-amount API: the amount comes from receipt e-mails or your own entry.", plan: "Kaj: pro", checkedAt: at, charges: [] },
  ];
}
