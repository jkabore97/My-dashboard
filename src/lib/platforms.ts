import { env } from "./source";
import type { Platform, SourceMode } from "./types";

interface PlatformDef extends Omit<Platform, "connected" | "mode"> {
  available: boolean;
}

// Every platform the business touches. "available" ones have a working
// connector in src/lib/connectors; the rest are on the roadmap (PROPOSAL.md).
export const PLATFORM_DEFS: PlatformDef[] = [
  { id: "github", name: "GitHub", category: "code", envKeys: ["GITHUB_TOKEN"], docsUrl: "https://github.com/settings/personal-access-tokens", available: true },
  { id: "vercel", name: "Vercel", category: "hosting", envKeys: ["VERCEL_TOKEN"], docsUrl: "https://vercel.com/account/settings/tokens", available: true },
  { id: "cloudflare", name: "Cloudflare", category: "hosting", envKeys: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"], docsUrl: "https://dash.cloudflare.com/profile/api-tokens", available: true },
  { id: "supabase", name: "Supabase", category: "database", envKeys: ["SUPABASE_ACCESS_TOKEN"], docsUrl: "https://supabase.com/dashboard/account/tokens", available: true },
  { id: "gmail", name: "Gmail", category: "email", envKeys: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GMAIL_ACCOUNTS"], docsUrl: "https://console.cloud.google.com/apis/credentials", available: true },
  { id: "websites", name: "Website monitor", category: "analytics", envKeys: ["WEBSITES"], docsUrl: "#", available: true, note: "Uptime + sign-ups per site" },
  { id: "outlook", name: "Microsoft 365 / Outlook", category: "email", envKeys: ["MS_CLIENT_ID", "MS_CLIENT_SECRET", "MS_REFRESH_TOKEN"], docsUrl: "https://entra.microsoft.com", available: false },
  { id: "stripe", name: "Stripe", category: "payments", envKeys: ["STRIPE_SECRET_KEY"], docsUrl: "https://dashboard.stripe.com/apikeys", available: false, note: "Revenue, disputes, failed payments" },
  { id: "ga4", name: "Google Analytics", category: "analytics", envKeys: ["GA4_PROPERTY_IDS"], docsUrl: "https://analytics.google.com", available: false, note: "Visitors per site" },
  { id: "gdrive", name: "Google Drive", category: "productivity", envKeys: ["GOOGLE_CLIENT_ID"], docsUrl: "https://drive.google.com", available: false },
  { id: "linkedin", name: "LinkedIn Page", category: "social", envKeys: ["LINKEDIN_TOKEN"], docsUrl: "https://www.linkedin.com/developers", available: false },
  { id: "slack", name: "Slack", category: "productivity", envKeys: ["SLACK_BOT_TOKEN"], docsUrl: "https://api.slack.com/apps", available: false },
];

export function getPlatforms(modes: Record<string, SourceMode | undefined>): (Platform & { available: boolean })[] {
  return PLATFORM_DEFS.map((p) => {
    const connected = p.available && p.envKeys.every((k) => !!env(k));
    return { ...p, connected, mode: modes[p.name.split(" ")[0]] ?? (connected ? "live" : "demo") };
  });
}
