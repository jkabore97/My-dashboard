import { addMonths, today as todayFn } from "../dates";
import { costQueryBody, parseCostRows, parseExportTable } from "../billing/google";
import type { GcpBillingAccount, GcpCostRow, GcpData, GcpExport, GcpProject } from "../billing/types";
import { businessFor, type BusinessRule } from "../server/config";
import { gcloudConnection, type GcloudSecret } from "../server/credentials";
import { gcpAccessToken, gcpApi, GcpApiError } from "../server/gcloud";
import { HOUR, slowCached } from "../server/slow-cache";
import { errorMessage, fromSource } from "../source";

// Google Cloud / Firebase through a service account: billing accounts,
// projects (with their billing link), Firebase projects for console links,
// and, when a BigQuery billing-export table is set, cost per month, project
// and service (read every few hours; the query is capped at 2 GB scanned).

const BILLING = "https://cloudbilling.googleapis.com/v1";

interface BqQueryResponse {
  jobComplete?: boolean;
  jobReference?: { jobId?: string; location?: string };
  schema?: { fields?: { name: string }[] };
  rows?: { f: { v: unknown }[] }[];
}

/** Runs the cost query on the export table. Never throws: problems become `error`. */
export async function fetchGcpCosts(token: string, tableText: string | null, rules: BusinessRule[], today: string): Promise<{ rows: GcpCostRow[]; export: GcpExport }> {
  const checkedAt = new Date().toISOString();
  if (!tableText) return { rows: [], export: { table: null, status: "none", error: null, checkedAt } };
  const t = parseExportTable(tableText);
  if (!t) return { rows: [], export: { table: tableText, status: "error", error: "The export table id should look like project.dataset.gcp_billing_export_v1_XXXXXX.", checkedAt } };
  const fail = (error: string) => ({ rows: [], export: { table: t.id, status: "error" as const, error, checkedAt } });
  try {
    const ds = await gcpApi<{ location?: string }>(token, `https://bigquery.googleapis.com/bigquery/v2/projects/${t.project}/datasets/${t.dataset}`);
    const url = `https://bigquery.googleapis.com/bigquery/v2/projects/${t.project}/queries`;
    let res: BqQueryResponse;
    try {
      res = await gcpApi<BqQueryResponse>(token, url, { method: "POST", body: costQueryBody(t, today, ds.location ?? null) });
    } catch (err) {
      // Tables made before export partitioning have no _PARTITIONTIME.
      if (!(err instanceof GcpApiError && /_PARTITIONTIME/i.test(err.message))) throw err;
      res = await gcpApi<BqQueryResponse>(token, url, { method: "POST", body: costQueryBody(t, today, ds.location ?? null, false) });
    }
    if (!res.jobComplete && res.jobReference?.jobId) {
      const q = new URLSearchParams({ timeoutMs: "20000", maxResults: "5000", ...(res.jobReference.location ? { location: res.jobReference.location } : {}) });
      res = await gcpApi<BqQueryResponse>(token, `${url}/${encodeURIComponent(res.jobReference.jobId)}?${q}`);
    }
    if (!res.jobComplete) return fail("The cost query took too long; it will be retried.");
    const rows = parseCostRows(res, (n) => businessFor(n, rules) ?? null);
    return { rows, export: { table: t.id, status: rows.length ? "ok" : "empty", error: rows.length ? null : "No billing rows yet. Export data appears about a day after you turn it on.", checkedAt } };
  } catch (err) {
    const msg = errorMessage(err);
    if (err instanceof GcpApiError && (err.status === 403 || err.status === 404)) {
      return fail(`${err.status === 404 ? "Export table or dataset not found" : "No access to the export table"}: give the service account BigQuery Data Viewer on the dataset and BigQuery Job User on project ${t.project}. (${msg})`);
    }
    return fail(`The cost query failed: ${msg}`);
  }
}

export async function getGoogleCloud(rules: BusinessRule[]) {
  const sa = await gcloudConnection();
  return fromSource<GcpData>(
    "Google Cloud",
    !!sa,
    async (fail) => {
      const key = sa as GcloudSecret;
      const token = await gcpAccessToken(key);
      const businessOf = (...names: (string | null | undefined)[]) => names.map((n) => (n ? businessFor(n, rules) : undefined)).find(Boolean) ?? null;

      const [accountsRes, projectsRes, firebaseRes] = await Promise.allSettled([
        gcpApi<{ billingAccounts?: { name: string; displayName?: string; open?: boolean; currencyCode?: string }[] }>(token, `${BILLING}/billingAccounts?pageSize=50`),
        gcpApi<{ projects?: { projectId: string; name?: string; projectNumber?: string; lifecycleState?: string }[] }>(token, "https://cloudresourcemanager.googleapis.com/v1/projects?pageSize=200"),
        gcpApi<{ results?: { projectId: string; displayName?: string; state?: string }[] }>(token, "https://firebase.googleapis.com/v1beta1/projects?pageSize=100"),
      ]);
      if (accountsRes.status === "rejected") fail("billing-accounts", `Billing accounts: ${errorMessage(accountsRes.reason)}`);
      if (projectsRes.status === "rejected") fail("projects", `Projects: ${errorMessage(projectsRes.reason)}`);
      if (firebaseRes.status === "rejected") fail("firebase", `Firebase: ${errorMessage(firebaseRes.reason)}`);

      const billingAccounts: GcpBillingAccount[] = (accountsRes.status === "fulfilled" ? accountsRes.value.billingAccounts ?? [] : []).map((a) => ({
        id: a.name.replace(/^billingAccounts\//, ""),
        name: a.displayName ?? a.name,
        open: a.open !== false,
        currency: a.currencyCode ? a.currencyCode.toLowerCase() : null,
      }));
      // Which project bills to which account (needs Billing Account Viewer).
      const links = new Map<string, { account: string; enabled: boolean }>();
      for (const a of billingAccounts.filter((x) => x.open).slice(0, 5)) {
        try {
          const r = await gcpApi<{ projectBillingInfo?: { projectId?: string; billingEnabled?: boolean }[] }>(token, `${BILLING}/billingAccounts/${encodeURIComponent(a.id)}/projects?pageSize=200`);
          for (const p of r.projectBillingInfo ?? []) if (p.projectId) links.set(p.projectId, { account: a.id, enabled: p.billingEnabled !== false });
        } catch (err) {
          fail(`billing:${a.id}`, `Projects on billing account ${a.name}: ${errorMessage(err)}`);
        }
      }
      const firebase = new Map((firebaseRes.status === "fulfilled" ? firebaseRes.value.results ?? [] : []).filter((p) => p.state !== "DELETED").map((p) => [p.projectId, p.displayName ?? p.projectId]));
      const listed = projectsRes.status === "fulfilled" ? (projectsRes.value.projects ?? []).filter((p) => !p.lifecycleState || p.lifecycleState === "ACTIVE") : [];
      const ids = new Set([...listed.map((p) => p.projectId), ...firebase.keys(), ...links.keys()]);
      const projects: GcpProject[] = [...ids].map((id) => {
        const p = listed.find((x) => x.projectId === id);
        const name = p?.name ?? firebase.get(id) ?? id;
        return { projectId: id, name, number: p?.projectNumber ?? null, billingAccount: links.get(id)?.account ?? null, billingEnabled: links.has(id) ? links.get(id)!.enabled : null, firebase: firebase.has(id), business: businessOf(name, id) };
      }).sort((a, b) => a.name.localeCompare(b.name));

      const today = todayFn();
      const costs = await slowCached("gcpcosts", [key.clientEmail, key.exportTable, rules], () => fetchGcpCosts(token, key.exportTable, rules, today), (r) => (r.export.status === "ok" ? 6 * HOUR : HOUR));
      return { serviceAccount: key.clientEmail, billingAccounts, projects, costs: costs.rows, export: costs.export };
    },
    demoGoogleCloud,
  );
}

export function demoGoogleCloud(): GcpData {
  const t = todayFn();
  const months = Array.from({ length: 6 }, (_, i) => addMonths(`${t.slice(0, 7)}-01`, i - 5).slice(0, 7));
  const row = (month: string, projectId: string, projectName: string, service: string, cost: number, credits: number, business: string): GcpCostRow => ({ month, projectId, projectName, service, currency: "usd", costMinor: cost, creditsMinor: credits, netMinor: cost + credits, business });
  const costs = months.flatMap((m, i) => [
    row(m, "kaj-store-prod", "Kaj Store", "Cloud Run", 1800 + i * 210, 0, "Kaj Store"),
    row(m, "kaj-store-prod", "Kaj Store", "Cloud Firestore", 640 + i * 40, -200, "Kaj Store"),
    row(m, "kaj-bookings", "Kaj Bookings", "Firebase Hosting", 120, 0, "Kaj Bookings"),
    row(m, "kaj-maps", "Kaj Consulting maps", "Places API", 2100 - i * 80, -1500, "Kaj Consulting"),
  ]);
  return {
    serviceAccount: "kaj-dashboard@kaj-dashboard.iam.gserviceaccount.com",
    billingAccounts: [{ id: "01ABCD-234567-89EFGH", name: "Kaj Group billing", open: true, currency: "usd" }],
    projects: [
      { projectId: "kaj-store-prod", name: "Kaj Store", number: "1234567890", billingAccount: "01ABCD-234567-89EFGH", billingEnabled: true, firebase: true, business: "Kaj Store" },
      { projectId: "kaj-bookings", name: "Kaj Bookings", number: "2234567890", billingAccount: "01ABCD-234567-89EFGH", billingEnabled: true, firebase: true, business: "Kaj Bookings" },
      { projectId: "kaj-maps", name: "Kaj Consulting maps", number: "3234567890", billingAccount: "01ABCD-234567-89EFGH", billingEnabled: true, firebase: false, business: "Kaj Consulting" },
    ],
    costs,
    export: { table: "kaj-dashboard.billing.gcp_billing_export_v1_01ABCD_234567_89EFGH", status: "ok", error: null, checkedAt: new Date().toISOString() },
  };
}
