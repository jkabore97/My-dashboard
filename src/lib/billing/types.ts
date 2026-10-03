import type { Severity } from "../types";

// Bills read automatically: Microsoft 365 / Azure billing, Google Cloud,
// other platforms' billing APIs, and bills recognised in shared mailboxes.
// Every shape here is JSON-safe (it is cached, encrypted, with the rest of
// the platform data) and survives emptyLike(): lists become [], other
// values null, so readers must accept nulls.

// ─── Microsoft 365 admin ─────────────────────────────────────────────────────

export interface MsLicence {
  sku: string;
  name: string;
  purchased: number;
  assigned: number;
  unassigned: number;
  /** Graph capabilityStatus: Enabled, Warning, Suspended, Deleted, LockedOut. */
  status: string;
  /** Free / viral / trial SKUs (huge seat counts): never a waste task. */
  free: boolean;
}

export interface MsHealthIssue {
  id: string;
  title: string;
  service: string;
  status: string;
  classification: "incident" | "advisory";
  severity: Severity;
  startedAt: string | null;
  impact: string | null;
  url: string;
}

export type BillingAgreement = "mca" | "mosp" | "ea" | "other";

export interface MsBillingAccount {
  name: string;
  displayName: string;
  agreement: BillingAgreement;
}

export type InvoiceStatus = "due" | "overdue" | "paid" | "void" | "other";

export interface MsInvoice {
  id: string;
  account: string;
  number: string;
  /** YYYY-MM-DD. */
  date: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  dueDate: string | null;
  status: InvoiceStatus;
  currency: string | null;
  /** Invoice total in minor units; null when the account type doesn't report it (older MOSP invoices). */
  totalMinor: number | null;
  dueMinor: number | null;
  profile: string | null;
  business: string | null;
  url: string;
}

export interface MsBilling {
  accounts: MsBillingAccount[];
  invoices: MsInvoice[];
  subscriptions: { name: string; status: string; business: string | null }[];
  /** Why billing couldn't be read (no billing role, consent missing…); null when it was. */
  error: string | null;
  checkedAt: string | null;
}

export interface MsAdminData {
  tenant: string | null;
  account: string | null;
  licences: MsLicence[];
  health: MsHealthIssue[];
  /** Why service health couldn't be read (permission or role missing), shown on the card instead of as an error. */
  healthNote?: string | null;
  billing: MsBilling;
}

// ─── Google Cloud / Firebase ─────────────────────────────────────────────────

export interface GcpBillingAccount {
  id: string;
  name: string;
  open: boolean;
  currency: string | null;
}

export interface GcpProject {
  projectId: string;
  name: string;
  number: string | null;
  billingAccount: string | null;
  billingEnabled: boolean | null;
  firebase: boolean;
  business: string | null;
}

export interface GcpCostRow {
  /** YYYY-MM (invoice month). */
  month: string;
  projectId: string | null;
  projectName: string | null;
  service: string;
  currency: string;
  costMinor: number;
  /** Credits are negative. */
  creditsMinor: number;
  netMinor: number;
  business: string | null;
}

export interface GcpExport {
  table: string | null;
  /** ok: rows read · empty: table has no rows yet · none: no table set · error. */
  status: "ok" | "empty" | "none" | "error" | null;
  error: string | null;
  checkedAt: string | null;
}

export interface GcpData {
  serviceAccount: string | null;
  billingAccounts: GcpBillingAccount[];
  projects: GcpProject[];
  costs: GcpCostRow[];
  export: GcpExport;
}

// ─── Other platforms' billing APIs ───────────────────────────────────────────

export type PlatformBillingId = "cloudflare" | "github" | "vercel" | "supabase" | "anthropic";

export interface PlatformCharge {
  id: string;
  /** YYYY-MM-DD. */
  date: string;
  description: string;
  amountMinor: number;
  currency: string;
  business: string | null;
  /** Months the charge pays for (12 for an annual plan or a domain renewal); 1 when missing. */
  periodMonths?: number;
}

export interface PlatformBilling {
  platform: PlatformBillingId;
  vendor: string;
  /**
   * ok: charges read · free: on a free plan, nothing billed · plan: only the
   * plan is known (no amounts) · permission: the token lacks billing access ·
   * error: the call failed.
   */
  status: "ok" | "free" | "plan" | "permission" | "error" | null;
  /** What happened / the one-line fix. */
  message: string | null;
  plan: string | null;
  charges: PlatformCharge[];
  checkedAt: string | null;
}

// ─── Bills recognised in shared mailboxes ────────────────────────────────────

export interface DetectedBill {
  id: string;
  vendor: string;
  vendorKey: string;
  amountMinor: number;
  currency: string;
  /** YYYY-MM-DD the e-mail arrived. */
  date: string;
  interval: "month" | "year";
  /**
   * The sender's domain passed SPF/DKIM/DMARC per the message's
   * Authentication-Results; false when the headers weren't available
   * (shown as "unverified sender"). Failing messages are dropped.
   */
  verified: boolean;
  subject: string;
  account: string;
  business: string | null;
  url: string | null;
}

/** Everything the Platform spend page reads besides your own subscription records. */
export interface Bills {
  microsoft: MsAdminData;
  google: GcpData;
  platforms: PlatformBilling[];
  email: DetectedBill[];
  /** Billing reads not done yet (they run in the background): names to show as "reading…". */
  pending: string[];
}
