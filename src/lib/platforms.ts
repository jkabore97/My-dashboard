import type { Platform, SourceMode } from "./types";

export interface TokenField {
  name: string;
  label: string;
  placeholder?: string;
  optional?: boolean;
  secret?: boolean;
}

export interface PlatformDef {
  id: string;
  name: string;
  category: Platform["category"];
  /** Has a working integration today (data connector and/or webhook). */
  available: boolean;
  docsUrl: string;
  note?: string;
  /** Provider id for stored connections, when the platform supports them. */
  provider?: "github" | "vercel" | "supabase" | "cloudflare" | "gmail" | "stripe" | "microsoft" | "hikvision";
  oauth?: "github" | "gmail" | "vercel" | "microsoft";
  token?: { fields: TokenField[]; help: string; /** Link text that opens the form, when "API key" is the wrong word. */ label?: string };
  webhook?: "github" | "vercel" | "stripe" | "supabase" | "hikvision";
  /** Source names (SourceResult.source) whose errors belong on this card; defaults to [name]. */
  sources?: string[];
  envKeys: string[];
  /**
   * Set up only through environment variables (no connection, no data
   * connector): the card shows on/off from whether every envKey is set.
   * Never shows the values.
   */
  configOnly?: { on: string; off: string };
}

const tokenField: TokenField = { name: "token", label: "API token", secret: true };

// Every platform the business touches. "available" ones work today; the rest
// are on the roadmap (PROPOSAL.md).
export const PLATFORM_DEFS: PlatformDef[] = [
  { id: "github", sources: ["GitHub", "GitHub security"], name: "GitHub", category: "code", available: true, provider: "github", oauth: "github", webhook: "github", envKeys: ["GITHUB_TOKEN"], docsUrl: "https://github.com/settings/personal-access-tokens", note: "Repos, PRs, issues, notifications, CI and security alerts", token: { fields: [tokenField], help: "Fine-grained token with read access to Metadata, Contents, Issues, Pull requests." } },
  { id: "vercel", name: "Vercel", category: "hosting", available: true, provider: "vercel", oauth: "vercel", webhook: "vercel", envKeys: ["VERCEL_TOKEN"], docsUrl: "https://vercel.com/account/settings/tokens", note: "Projects and production deploys", token: { fields: [tokenField, { name: "teamId", label: "Team ID", placeholder: "team_…", optional: true }], help: "Create a token under Account Settings → Tokens, scoped to your team." } },
  { id: "cloudflare", name: "Cloudflare", category: "hosting", available: true, provider: "cloudflare", envKeys: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"], docsUrl: "https://dash.cloudflare.com/profile/api-tokens", note: "Workers and D1 databases", token: { fields: [tokenField, { name: "accountId", label: "Account ID", placeholder: "32-character ID" }], help: "Token permissions: Account Settings:Read, Workers Scripts:Read, D1:Read." } },
  { id: "supabase", name: "Supabase", category: "database", available: true, provider: "supabase", webhook: "supabase", envKeys: ["SUPABASE_ACCESS_TOKEN"], docsUrl: "https://supabase.com/dashboard/account/tokens", note: "Project health, security advisors, user counts", token: { fields: [tokenField], help: "Personal access token from Account → Access Tokens." } },
  { id: "gmail", name: "Google", category: "email", available: true, provider: "gmail", oauth: "gmail", envKeys: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"], docsUrl: "https://console.cloud.google.com/apis/credentials", note: "Gmail, Calendar, Analytics and Search Console, read-only. Connect each business account.", sources: ["Gmail", "Calendar", "Analytics"] },
  { id: "microsoft", name: "Microsoft 365", category: "email", available: true, provider: "microsoft", oauth: "microsoft", envKeys: ["MS_CLIENT_ID", "MS_CLIENT_SECRET"], docsUrl: "https://entra.microsoft.com", note: "Outlook mail and calendar, read-only. Connect each mailbox.", sources: ["Outlook", "Calendar"] },
  { id: "reviews", name: "Google reviews", category: "social", available: true, envKeys: ["GOOGLE_PLACES_API_KEY"], docsUrl: "/settings#places", note: "Rating and recent reviews per business (Places API). Add place IDs in Settings." },
  { id: "stripe", name: "Stripe", category: "payments", available: true, provider: "stripe", webhook: "stripe", envKeys: ["STRIPE_SECRET_KEYS"], docsUrl: "https://dashboard.stripe.com/apikeys", note: "Revenue, MRR, balances, disputes and overdue invoices. Add one key per business.", token: { fields: [{ name: "token", label: "Restricted key", placeholder: "rk_live_…", secret: true }, { name: "business", label: "Business" }], help: "Create a restricted key with Read access to Balance, Charges, Disputes, Invoices, Subscriptions, Customers and Accounts. Use one key per Stripe account; two keys for the same account would double-count." } },
  { id: "websites", sources: ["Websites", "Domains"], name: "Website monitor", category: "analytics", available: true, envKeys: [], docsUrl: "/settings#websites", note: "Uptime every 5 minutes + sign-ups per site" },
  { id: "hikvision", name: "Hikvision cameras", category: "devices", available: true, provider: "hikvision", webhook: "hikvision", sources: ["Cameras"], envKeys: [], docsUrl: "/cameras", note: "NVR and camera status, live snapshots, disk health and alarms (ISAPI through a secure tunnel). Add one per site.", token: { fields: [{ name: "baseUrl", label: "Tunnel address", placeholder: "https://nvr.yourdomain.com" }, { name: "username", label: "NVR username", placeholder: "a read-only operator account" }, { name: "token", label: "NVR password", secret: true }, { name: "label", label: "Site name", placeholder: "Office", optional: true }, { name: "business", label: "Business", optional: true }, { name: "cfClientId", label: "Cloudflare Access client ID", optional: true }, { name: "cfClientSecret", label: "Cloudflare Access client secret", optional: true, secret: true }], label: "Add a recorder site", help: "Expose the NVR's web port through Cloudflare Tunnel (or Tailscale Funnel), never by port forwarding. Create a separate NVR user with only Remote: Live View and Parameters Settings view rights. If you protect the tunnel with Cloudflare Access, add a service token here. See the README for the 5-minute setup." } },
  { id: "solar", name: "Solar (SOFAR / Fsolar)", category: "devices", available: true, sources: ["Solar"], envKeys: ["SOLAR_INGEST_TOKEN"], docsUrl: "/settings#solar", note: "Production, battery, grid and alarms from your SOFAR inverter, pushed by Home Assistant or a small script. Direct Fsolar cloud sync waits on SOFAR granting API access." },
  { id: "resend", name: "Resend email", category: "email", available: true, envKeys: ["RESEND_API_KEY", "BRIEF_EMAIL_FROM", "BRIEF_EMAIL_TO"], docsUrl: "https://resend.com/api-keys", note: "Sends the morning brief and weekly reports by email.", configOnly: { on: "Morning brief and weekly reports go out by email.", off: "Off until RESEND_API_KEY, BRIEF_EMAIL_FROM and BRIEF_EMAIL_TO are set." } },
  { id: "claude", name: "Claude AI", category: "productivity", available: true, envKeys: ["ANTHROPIC_API_KEY"], docsUrl: "https://console.anthropic.com/settings/keys", note: "Powers Ask, inbox triage, reply drafts and the morning brief summary.", configOnly: { on: "Ask, triage and summaries use Claude.", off: "Off until ANTHROPIC_API_KEY is set; Ask answers from rules only." } },
  { id: "gdrive", name: "Google Drive", category: "productivity", available: false, envKeys: [], docsUrl: "https://drive.google.com" },
  { id: "linkedin", name: "LinkedIn Page", category: "social", available: false, envKeys: [], docsUrl: "https://www.linkedin.com/developers" },
  { id: "slack", name: "Slack", category: "productivity", available: false, envKeys: [], docsUrl: "https://api.slack.com/apps" },
];

/** Pure: whether a config-only platform is on (every env key set). */
export function configStatus(p: Pick<PlatformDef, "envKeys">, has: (key: string) => boolean): { on: boolean; keys: { key: string; set: boolean }[] } {
  const keys = p.envKeys.map((key) => ({ key, set: has(key) }));
  return { on: keys.length > 0 && keys.every((k) => k.set), keys };
}

/** Live/demo/error per platform, keyed by platform id. */
export function getPlatforms(modes: Record<string, SourceMode | undefined>) {
  return PLATFORM_DEFS.filter((p) => p.available).map((p) => ({ ...p, mode: modes[p.id] ?? null }));
}
