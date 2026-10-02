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
  provider?: "github" | "vercel" | "supabase" | "cloudflare" | "gmail" | "stripe";
  oauth?: "github" | "gmail" | "vercel";
  token?: { fields: TokenField[]; help: string };
  webhook?: "github" | "vercel" | "stripe" | "supabase";
  envKeys: string[];
}

const tokenField: TokenField = { name: "token", label: "API token", secret: true };

// Every platform the business touches. "available" ones work today; the rest
// are on the roadmap (PROPOSAL.md).
export const PLATFORM_DEFS: PlatformDef[] = [
  { id: "github", name: "GitHub", category: "code", available: true, provider: "github", oauth: "github", webhook: "github", envKeys: ["GITHUB_TOKEN"], docsUrl: "https://github.com/settings/personal-access-tokens", note: "Repos, PRs, issues, notifications, CI and security alerts", token: { fields: [tokenField], help: "Fine-grained token with read access to Metadata, Contents, Issues, Pull requests." } },
  { id: "vercel", name: "Vercel", category: "hosting", available: true, provider: "vercel", oauth: "vercel", webhook: "vercel", envKeys: ["VERCEL_TOKEN"], docsUrl: "https://vercel.com/account/settings/tokens", note: "Projects and production deploys", token: { fields: [tokenField, { name: "teamId", label: "Team ID", placeholder: "team_…", optional: true }], help: "Create a token under Account Settings → Tokens, scoped to your team." } },
  { id: "cloudflare", name: "Cloudflare", category: "hosting", available: true, provider: "cloudflare", envKeys: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"], docsUrl: "https://dash.cloudflare.com/profile/api-tokens", note: "Workers and D1 databases", token: { fields: [tokenField, { name: "accountId", label: "Account ID", placeholder: "32-character ID" }], help: "Token permissions: Account Settings:Read, Workers Scripts:Read, D1:Read." } },
  { id: "supabase", name: "Supabase", category: "database", available: true, provider: "supabase", webhook: "supabase", envKeys: ["SUPABASE_ACCESS_TOKEN"], docsUrl: "https://supabase.com/dashboard/account/tokens", note: "Project health, security advisors, user counts", token: { fields: [tokenField], help: "Personal access token from Account → Access Tokens." } },
  { id: "gmail", name: "Gmail", category: "email", available: true, provider: "gmail", oauth: "gmail", envKeys: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"], docsUrl: "https://console.cloud.google.com/apis/credentials", note: "Connect each business mailbox (read-only)" },
  { id: "stripe", name: "Stripe", category: "payments", available: true, provider: "stripe", webhook: "stripe", envKeys: ["STRIPE_SECRET_KEYS"], docsUrl: "https://dashboard.stripe.com/apikeys", note: "Revenue, MRR, balances, disputes and overdue invoices. Add one key per business.", token: { fields: [{ name: "token", label: "Restricted key", placeholder: "rk_live_…", secret: true }, { name: "business", label: "Business" }], help: "Create a restricted key with Read access to Balance, Charges, Disputes, Invoices, Subscriptions and Customers." } },
  { id: "websites", name: "Website monitor", category: "analytics", available: true, envKeys: [], docsUrl: "/settings#websites", note: "Uptime every 5 minutes + sign-ups per site" },
  { id: "outlook", name: "Microsoft 365 / Outlook", category: "email", available: false, envKeys: [], docsUrl: "https://entra.microsoft.com" },
  { id: "ga4", name: "Google Analytics", category: "analytics", available: false, envKeys: [], docsUrl: "https://analytics.google.com", note: "Visitors per site" },
  { id: "gdrive", name: "Google Drive", category: "productivity", available: false, envKeys: [], docsUrl: "https://drive.google.com" },
  { id: "linkedin", name: "LinkedIn Page", category: "social", available: false, envKeys: [], docsUrl: "https://www.linkedin.com/developers" },
  { id: "slack", name: "Slack", category: "productivity", available: false, envKeys: [], docsUrl: "https://api.slack.com/apps" },
];

/** Live/demo/error status for the connectors shown on the overview. */
export function getPlatforms(modes: Record<string, SourceMode | undefined>) {
  // Platforms without a polling source (none today) have no mode.
  return PLATFORM_DEFS.filter((p) => p.available).map((p) => ({ ...p, mode: modes[p.name.split(" ")[0]] ?? null }));
}
