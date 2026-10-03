import { addMonths, today as todayFn } from "../dates";
import { armTokenMessage, billingErrorMessage, parseBillingAccounts, parseHealthIssues, parseInvoices, parseSkus, M365_ADMIN } from "../billing/microsoft";
import type { MsAdminData, MsBilling } from "../billing/types";
import { businessFor, type BusinessRule } from "../server/config";
import { msAdminConnection } from "../server/credentials";
import { graph, msClient } from "../server/microsoft";
import { ArmError, armGet, msAdminToken, MsTokenError } from "../server/msadmin";
import { HOUR } from "../server/slow-cache";
import { errorMessage, fromSource } from "../source";

// Microsoft 365 admin: licences and service health from Graph on every
// refresh. Invoices (Azure billing) are slow to page through: they're read
// in the background every few hours (server/billing-refresh.ts) and merged
// in collect(); this source only carries a placeholder for them.

const API = "api-version=2024-04-01";

type Conn = { account: string; refreshToken: string };

/** Billing accounts, the last 12 months of invoices and billing subscriptions. Never throws: problems become `error`. */
export async function fetchMsBilling(conn: Conn, rules: BusinessRule[], today: string, signal?: AbortSignal): Promise<MsBilling> {
  const checkedAt = new Date().toISOString();
  const empty = (error: string): MsBilling => ({ accounts: [], invoices: [], subscriptions: [], error, checkedAt });
  let token: string;
  try {
    token = await msAdminToken(conn, "arm");
  } catch (err) {
    return empty(armTokenMessage(err instanceof MsTokenError ? err.message : errorMessage(err)));
  }
  let accounts;
  try {
    accounts = parseBillingAccounts((await armGet<{ value?: [] }>(token, `/providers/Microsoft.Billing/billingAccounts?${API}`, signal)).value);
  } catch (err) {
    return empty(err instanceof ArmError ? billingErrorMessage(err.status, err.code, conn.account) : `Azure billing couldn't be reached (${errorMessage(err)}).`);
  }
  if (!accounts.length) return empty(billingErrorMessage(403, "AuthorizationFailed", conn.account).replace("can't read billing", "sees no billing account"));
  const businessOf = (name: string) => businessFor(name, rules) ?? null;
  const start = addMonths(`${today.slice(0, 7)}-01`, -12);
  const invoices: MsBilling["invoices"] = [];
  const subscriptions: MsBilling["subscriptions"] = [];
  const errors: string[] = [];
  for (const a of accounts.slice(0, 5)) {
    const base = `/providers/Microsoft.Billing/billingAccounts/${a.name}`;
    try {
      let url: string | null = `${base}/invoices?periodStartDate=${start}&periodEndDate=${today}&${API}`;
      for (let page = 0; url && page < 4; page++) {
        const res: { value?: []; nextLink?: string } = await armGet(token, url, signal);
        invoices.push(...parseInvoices(a.name, res.value, today, (n) => businessOf(n) ?? businessOf(a.displayName)));
        url = res.nextLink && res.nextLink.startsWith("https://management.azure.com/") ? res.nextLink : null;
      }
    } catch (err) {
      errors.push(err instanceof ArmError ? billingErrorMessage(err.status, err.code, conn.account) : errorMessage(err));
    }
    // Cheap extra: what's on the account (not every account type supports it).
    try {
      const res = await armGet<{ value?: { name?: string; properties?: { displayName?: string; status?: string; subscriptionBillingStatus?: string; productName?: string } }[] }>(token, `${base}/billingSubscriptions?${API}`, signal);
      for (const s of res.value ?? []) {
        const name = s.properties?.displayName ?? s.properties?.productName ?? s.name ?? "Subscription";
        subscriptions.push({ name, status: s.properties?.status ?? s.properties?.subscriptionBillingStatus ?? "unknown", business: businessOf(name) });
      }
    } catch {
      /* optional */
    }
  }
  return { accounts, invoices: invoices.sort((x, y) => (y.date ?? "").localeCompare(x.date ?? "")), subscriptions, error: errors.length && !invoices.length ? errors[0] : null, checkedAt };
}

/** Not read yet (the background billing read fills it in). */
export const pendingMsBilling = (): MsBilling => ({ accounts: [], invoices: [], subscriptions: [], error: null, checkedAt: null });

export async function getMsAdmin(rules: BusinessRule[]) {
  const conn = await msAdminConnection();
  return fromSource<MsAdminData>(
    "Microsoft 365 admin",
    !!conn && !!msClient(),
    async (fail) => {
      const c = { account: conn!.account, refreshToken: conn!.refreshToken };
      const token = await msAdminToken(c, "graph");
      const [skus, health, org] = await Promise.allSettled([
        graph<{ value?: [] }>(token, "/subscribedSkus"),
        graph<{ value?: [] }>(token, `/admin/serviceAnnouncement/issues?${new URLSearchParams({ $filter: "isResolved eq false", $top: "100" })}`),
        graph<{ value?: { displayName?: string }[] }>(token, "/organization?$select=displayName"),
      ]);
      if (skus.status === "rejected") fail("licences", `Licences: ${errorMessage(skus.reason)}`);
      // Service health needs ServiceHealth.Read.All with admin consent and an admin role
      // (Global Reader, Service Support Administrator…). A 403 is a setup step, not an outage.
      const healthDenied = health.status === "rejected" && /\b403\b/.test(errorMessage(health.reason));
      if (health.status === "rejected" && !healthDenied) fail("health", `Service health: ${errorMessage(health.reason)}`);
      return {
        tenant: org.status === "fulfilled" ? (org.value.value?.[0]?.displayName ?? null) : null,
        account: c.account,
        licences: skus.status === "fulfilled" ? parseSkus(skus.value.value) : [],
        health: health.status === "fulfilled" ? parseHealthIssues(health.value.value) : [],
        healthNote: healthDenied
          ? "Service health isn't readable yet: in Entra add Microsoft Graph → Delegated → ServiceHealth.Read.All, click Grant admin consent, make sure your account has an admin role (e.g. Global Reader), then Reconnect."
          : null,
        billing: pendingMsBilling(),
      };
    },
    demoMsAdmin,
  );
}

export function demoMsAdmin(): MsAdminData {
  const t = todayFn();
  const month = (n: number) => addMonths(`${t.slice(0, 7)}-01`, -n);
  const inv = (n: number, total: number, status: "paid" | "due") => ({
    id: `demo/G0${n}`, account: "demo", number: `G0${40 + n}`, date: month(n), periodStart: month(n + 1), periodEnd: month(n), dueDate: addMonths(month(n), 1),
    status, currency: "usd", totalMinor: total, dueMinor: status === "due" ? total : 0, profile: "Kaj Consulting", business: "Kaj Consulting", url: `${M365_ADMIN}#/billoverview/invoice-list`,
  });
  return {
    tenant: "Kaj Group (sample)",
    account: "admin@kaj.example",
    licences: [
      { sku: "O365_BUSINESS_PREMIUM", name: "Microsoft 365 Business Standard", purchased: 8, assigned: 6, unassigned: 2, status: "Enabled", free: false },
      { sku: "EXCHANGESTANDARD", name: "Exchange Online (Plan 1)", purchased: 3, assigned: 3, unassigned: 0, status: "Enabled", free: false },
      { sku: "FLOW_FREE", name: "FLOW FREE", purchased: 10000, assigned: 2, unassigned: 9998, status: "Enabled", free: true },
    ],
    health: [{ id: "EX000000", title: "Some users may see delays receiving email", service: "Exchange Online", status: "serviceDegradation", classification: "incident", severity: "high", startedAt: new Date(Date.now() - 3 * HOUR).toISOString(), impact: "Messages may be delayed by up to 30 minutes.", url: `${M365_ADMIN}#/servicehealth` }],
    billing: { accounts: [{ name: "demo", displayName: "Kaj Group", agreement: "mca" }], invoices: [inv(0, 11_250, "due"), inv(1, 11_250, "paid"), inv(2, 9_840, "paid"), inv(3, 9_840, "paid")], subscriptions: [{ name: "Microsoft 365 Business Standard", status: "Active", business: "Kaj Consulting" }], error: null, checkedAt: new Date().toISOString() },
  };
}
