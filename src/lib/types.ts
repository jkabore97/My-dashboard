// Shared shapes every connector normalizes into. The UI only ever sees these,
// so adding a new platform means writing one connector, not touching pages.

export type Severity = "critical" | "high" | "medium" | "low";

export const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low"];

export type SourceMode = "live" | "demo" | "error";

export interface SourceResult<T> {
  source: string;
  mode: SourceMode;
  data: T;
  error?: string;
  /** Parts that failed while the rest answered (a mailbox, a project's advisors…), keyed by that part's id. */
  partial?: { key: string; error: string }[];
  fetchedAt: string;
}

export interface Repo {
  id: string;
  name: string;
  fullName: string;
  url: string;
  private: boolean;
  language: string | null;
  defaultBranch: string;
  /** Null when the PR count couldn't be fetched (issues can't be told apart from PRs then). */
  openIssues: number | null;
  openPullRequests: number | null;
  pushedAt: string;
  business?: string;
}

export type DeployState = "ready" | "building" | "error" | "canceled" | "queued";

export interface HostingProject {
  id: string;
  name: string;
  provider: "vercel" | "cloudflare" | "netlify" | "other";
  url: string | null;
  framework: string | null;
  lastDeployState: DeployState | null;
  lastDeployAt: string | null;
  repo?: string;
  business?: string;
}

export interface Database {
  id: string;
  name: string;
  provider: "supabase" | "cloudflare-d1" | "neon" | "other";
  region: string | null;
  status: "healthy" | "paused" | "degraded" | "unknown";
  createdAt: string | null;
  advisories?: { level: Severity; title: string }[];
  business?: string;
}

export interface EmailMessage {
  id: string;
  from: string;
  subject: string;
  snippet: string;
  receivedAt: string;
  unread: boolean;
  /** Display label of the mailbox (editable). */
  account: string;
  /** Stable mailbox id (the address, or env:<label>); task keys use this. */
  mailbox: string;
  labels: string[];
  severity: Severity;
  url?: string;
}

export interface Task {
  id: string;
  title: string;
  detail?: string;
  severity: Severity;
  source: string;
  url?: string;
  createdAt: string;
  business?: string;
}

export interface Notification {
  id: string;
  source: string;
  title: string;
  body?: string;
  at: string;
  severity: Severity;
  url?: string;
}

export interface Website {
  id: string;
  domain: string;
  business: string;
  status: "up" | "down" | "degraded" | "unknown";
  responseMs: number | null;
  totalUsers: number | null;
  newUsers7d: number | null;
  visitors7d: number | null;
  hostingProjectId?: string;
}

export interface Platform {
  id: string;
  name: string;
  category: "code" | "hosting" | "database" | "email" | "analytics" | "payments" | "social" | "productivity";
  connected: boolean;
  mode: SourceMode;
  envKeys: string[];
  docsUrl: string;
  note?: string;
}

export interface MoneyLine {
  currency: string;
  amount: number;
}

export interface StripeDispute {
  id: string;
  amount: number;
  currency: string;
  reason: string;
  status: string;
  dueBy: string | null;
  created: string;
}

export interface ReceivableInvoice {
  id: string;
  source: "stripe" | "manual";
  business: string | null;
  client: string;
  number: string | null;
  amount: number;
  currency: string;
  dueOn: string | null;
  url?: string;
}

export interface StripeAccountSummary {
  /** Stable account id (task keys use it). */
  id: string;
  business: string;
  livemode: boolean;
  balance: { currency: string; available: number; pending: number }[];
  /** Last 30 days, per currency. */
  revenue: { currency: string; gross: number; refunds: number; fees: number; net: number }[];
  /** Gross charges per UTC day for the last 30 days, per currency. */
  daily: { date: string; currency: string; gross: number }[];
  mrr: MoneyLine[];
  activeSubscriptions: number;
  pastDueSubscriptions: number;
  disputes: StripeDispute[];
  openInvoices: ReceivableInvoice[];
  /** True when a list was cut off at the page limit. */
  truncated: boolean;
}

export interface SecurityAlert {
  kind: "dependabot" | "secret";
  repo: string;
  number: number;
  severity: Severity;
  title: string;
  url: string;
  createdAt: string;
}

export interface RepoSecurity {
  repo: string;
  dependabot: "on" | "off" | "unknown";
  secretScanning: "on" | "unavailable" | "unknown";
}

export interface SecurityReport {
  alerts: SecurityAlert[];
  repos: RepoSecurity[];
  /** GitHub account two-factor status; null when the token can't tell. */
  github2fa: boolean | null;
  githubLogin: string | null;
}
