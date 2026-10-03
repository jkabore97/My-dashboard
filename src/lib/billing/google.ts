import { createPrivateKey } from "node:crypto";
import { addMonths } from "../dates";
import { minorUnits, sumByCurrency, type CurrencyAmount } from "../money";
import type { GcpCostRow } from "./types";

// Pure parts of the Google Cloud connector: the service-account key check,
// the billing-export table id, the BigQuery cost query and its aggregation.

export const GCP_SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform.read-only",
  "https://www.googleapis.com/auth/bigquery.readonly",
  "https://www.googleapis.com/auth/cloud-billing.readonly",
];

export interface ServiceAccountKey {
  clientEmail: string;
  privateKey: string;
  privateKeyId: string | null;
  projectId: string;
}

/**
 * Checks a pasted service-account JSON key. Errors never quote the key.
 * The token endpoint is always Google's own, whatever the file says.
 */
export function parseServiceAccountKey(text: string): { key: ServiceAccountKey } | { error: string } {
  if (!text.trim()) return { error: "Paste the service account's JSON key." };
  if (text.length > 20_000) return { error: "That doesn't look like a service-account key (too long)." };
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { error: "That isn't valid JSON. Paste the whole key file, from { to }." };
  }
  if (!j || typeof j !== "object" || j.type !== "service_account") return { error: "This JSON isn't a service-account key (\"type\" must be \"service_account\")." };
  const clientEmail = typeof j.client_email === "string" ? j.client_email.trim().toLowerCase() : "";
  const privateKey = typeof j.private_key === "string" ? j.private_key : "";
  const projectId = typeof j.project_id === "string" ? j.project_id.trim() : "";
  const privateKeyId = typeof j.private_key_id === "string" && /^[a-f0-9]{8,64}$/i.test(j.private_key_id) ? j.private_key_id : null;
  if (!/^[a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com$/.test(clientEmail)) return { error: "client_email must be a service account (…@….iam.gserviceaccount.com)." };
  if (!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(projectId)) return { error: "project_id is missing or invalid." };
  if (!privateKey.includes("-----BEGIN PRIVATE KEY-----")) return { error: "private_key is missing or isn't a PEM private key." };
  try {
    const k = createPrivateKey(privateKey);
    if (k.asymmetricKeyType !== "rsa") return { error: "The private key must be an RSA key." };
  } catch {
    return { error: "The private key couldn't be read. Download a fresh JSON key." };
  }
  return { key: { clientEmail, privateKey, privateKeyId, projectId } };
}

export interface ExportTable {
  project: string;
  dataset: string;
  table: string;
  /** project.dataset.table */
  id: string;
}

/** "project.dataset.table" (also "project:dataset.table", backticks allowed); null when invalid. */
export function parseExportTable(text: string): ExportTable | null {
  const t = text.trim().replace(/^`|`$/g, "");
  const m = /^([a-z][a-z0-9-]{4,61}[a-z0-9])[.:]([A-Za-z0-9_]{1,1024})\.([A-Za-z0-9_]{1,1024})$/.exec(t);
  if (!m) return null;
  return { project: m[1], dataset: m[2], table: m[3], id: `${m[1]}.${m[2]}.${m[3]}` };
}

/** First invoice month included: the current month and the 5 before it ("YYYYMM"). */
export function costWindow(today: string, months = 6): { fromMonth: string; since: string } {
  const since = addMonths(`${today.slice(0, 7)}-01`, -(months - 1));
  return { fromMonth: since.slice(0, 7).replace("-", ""), since };
}

/**
 * Cost per invoice month, project, service and currency; net = cost + credits
 * (credits are negative). The partition filter keeps the scan to the window;
 * `partitioned: false` drops it for tables without ingestion-time partitions.
 */
export function buildCostQuery(t: ExportTable, partitioned = true): string {
  return [
    "SELECT invoice.month AS month, project.id AS project_id, project.name AS project_name, service.description AS service, currency,",
    "  SUM(cost) AS cost, SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) c), 0)) AS credits",
    `FROM \`${t.id}\``,
    `WHERE invoice.month >= @from_month${partitioned ? " AND DATE(_PARTITIONTIME) >= @since" : ""}`,
    "GROUP BY month, project_id, project_name, service, currency",
  ].join("\n");
}

export function costQueryBody(t: ExportTable, today: string, location: string | null, partitioned = true) {
  const w = costWindow(today);
  return {
    query: buildCostQuery(t, partitioned),
    useLegacySql: false,
    parameterMode: "NAMED",
    queryParameters: [
      { name: "from_month", parameterType: { type: "STRING" }, parameterValue: { value: w.fromMonth } },
      ...(partitioned ? [{ name: "since", parameterType: { type: "DATE" }, parameterValue: { value: w.since } }] : []),
    ],
    ...(location ? { location } : {}),
    // BigQuery answers within this or returns a job to poll once; the HTTP call itself is capped too.
    timeoutMs: 10_000,
    maxResults: 5000,
    // A hard ceiling: the query fails rather than scanning more than 2 GB.
    maximumBytesBilled: "2000000000",
  };
}

interface BqResponse {
  jobComplete?: boolean;
  schema?: { fields?: { name: string }[] };
  rows?: { f: { v: unknown }[] }[];
}

/** BigQuery rows → cost rows in minor units, with the business from the project. */
export function parseCostRows(res: BqResponse, businessOf: (name: string) => string | null = () => null): GcpCostRow[] {
  const names = (res.schema?.fields ?? []).map((f) => f.name);
  const at = (row: { f: { v: unknown }[] }, name: string) => row.f[names.indexOf(name)]?.v ?? null;
  const out: GcpCostRow[] = [];
  for (const row of res.rows ?? []) {
    const month = String(at(row, "month") ?? "");
    const currency = String(at(row, "currency") ?? "").toLowerCase();
    if (!/^\d{6}$/.test(month) || !/^[a-z]{3}$/.test(currency)) continue;
    const cost = Number(at(row, "cost") ?? 0);
    const credits = Number(at(row, "credits") ?? 0);
    if (!Number.isFinite(cost) || !Number.isFinite(credits)) continue;
    const u = minorUnits(currency);
    const costMinor = Math.round(cost * u);
    const creditsMinor = Math.round(credits * u);
    if (costMinor === 0 && creditsMinor === 0) continue;
    const projectId = (at(row, "project_id") as string | null) || null;
    const projectName = (at(row, "project_name") as string | null) || null;
    out.push({
      month: `${month.slice(0, 4)}-${month.slice(4)}`,
      projectId,
      projectName,
      service: String(at(row, "service") ?? "Other"),
      currency,
      costMinor,
      creditsMinor,
      netMinor: costMinor + creditsMinor,
      business: projectName || projectId ? businessOf(projectName ?? "") ?? businessOf(projectId ?? "") : null,
    });
  }
  return out;
}

export interface GcpCostSummary {
  months: { month: string; totals: CurrencyAmount[] }[];
  projects: { key: string; projectId: string | null; name: string; business: string | null; byMonth: Record<string, CurrencyAmount[]>; total: CurrencyAmount[] }[];
  services: { service: string; total: CurrencyAmount[] }[];
}

const largest = (t: CurrencyAmount[]) => t[0]?.amount ?? 0;

/** Net cost per month (oldest first), per project and per service (biggest first). */
export function aggregateGcpCosts(rows: GcpCostRow[]): GcpCostSummary {
  const months = new Map<string, CurrencyAmount[]>();
  const projects = new Map<string, GcpCostSummary["projects"][number] & { items: CurrencyAmount[] }>();
  const services = new Map<string, CurrencyAmount[]>();
  for (const r of rows) {
    const amt = { currency: r.currency, amount: r.netMinor };
    months.set(r.month, [...(months.get(r.month) ?? []), amt]);
    const key = r.projectId ?? "(no project)";
    const p = projects.get(key) ?? { key, projectId: r.projectId, name: r.projectName ?? r.projectId ?? "No project (account-level charges)", business: r.business, byMonth: {}, total: [], items: [] };
    p.byMonth[r.month] = sumByCurrency([...(p.byMonth[r.month] ?? []), amt]);
    p.items.push(amt);
    projects.set(key, p);
    services.set(r.service, [...(services.get(r.service) ?? []), amt]);
  }
  return {
    months: [...months].map(([month, items]) => ({ month, totals: sumByCurrency(items) })).sort((a, b) => a.month.localeCompare(b.month)),
    projects: [...projects.values()].map(({ items, ...p }) => ({ ...p, total: sumByCurrency(items) })).sort((a, b) => largest(b.total) - largest(a.total) || a.name.localeCompare(b.name)),
    services: [...services].map(([service, items]) => ({ service, total: sumByCurrency(items) })).sort((a, b) => largest(b.total) - largest(a.total)),
  };
}

export const gcpConsole = (projectId?: string | null) => (projectId ? `https://console.cloud.google.com/home/dashboard?project=${encodeURIComponent(projectId)}` : "https://console.cloud.google.com");
export const gcpBillingConsole = (projectId?: string | null) => (projectId ? `https://console.cloud.google.com/billing/linkedaccount?project=${encodeURIComponent(projectId)}` : "https://console.cloud.google.com/billing");
export const firebaseConsole = (projectId: string) => `https://console.firebase.google.com/project/${encodeURIComponent(projectId)}/overview`;
