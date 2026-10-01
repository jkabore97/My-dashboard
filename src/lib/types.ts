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
  openIssues: number;
  openPullRequests: number;
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
  account: string;
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
