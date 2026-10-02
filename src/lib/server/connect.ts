import { env } from "../source";
import { clientIp } from "./auth";
import { audit } from "./store/audit";
import type { Provider } from "./store/connections";
import { GOOGLE_SCOPES } from "./google";
import { MS_SCOPES, msClient, msTenant } from "./microsoft";

// OAuth "Connect" flows for platforms whose data the dashboard reads.
export type OAuthProvider = "github" | "gmail" | "vercel" | "microsoft";

export function oauthConfigured(p: OAuthProvider): boolean {
  if (p === "github") return !!(env("GITHUB_OAUTH_CLIENT_ID") && env("GITHUB_OAUTH_CLIENT_SECRET"));
  if (p === "gmail") return !!(env("GOOGLE_CLIENT_ID") && env("GOOGLE_CLIENT_SECRET"));
  if (p === "microsoft") return !!msClient();
  return !!(env("VERCEL_INTEGRATION_SLUG") && env("VERCEL_CLIENT_ID") && env("VERCEL_CLIENT_SECRET"));
}

export const isOAuthProvider = (p: string): p is OAuthProvider => p === "github" || p === "gmail" || p === "vercel" || p === "microsoft";

/** Providers a person can connect as their own mailbox and calendar. */
export type PersonalProvider = "microsoft" | "gmail";
export const isPersonalProvider = (p: string): p is PersonalProvider => p === "microsoft" || p === "gmail";

/**
 * `personal` is someone connecting their own mailbox: Microsoft is also asked
 * for an ID token (who signed in), and both are hinted to the person's address.
 */
export function authorizeUrl(p: OAuthProvider, redirectUri: string, state: string, personal?: { email: string }): string {
  const hint: Record<string, string> = personal && /^[^\s@]{1,64}@[^\s@]{1,190}$/.test(personal.email) ? { login_hint: personal.email } : {};
  if (p === "github") {
    return `https://github.com/login/oauth/authorize?${new URLSearchParams({
      client_id: env("GITHUB_OAUTH_CLIENT_ID")!,
      redirect_uri: redirectUri,
      scope: "repo read:org notifications",
      state,
      allow_signup: "false",
    })}`;
  }
  if (p === "gmail") {
    return `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
      client_id: env("GOOGLE_CLIENT_ID")!,
      redirect_uri: redirectUri,
      response_type: "code",
      // One consent covers mail, calendar, Analytics and Search Console (all read-only).
      scope: ["openid", "email", ...Object.values(GOOGLE_SCOPES)].join(" "),
      access_type: "offline",
      prompt: "consent select_account",
      include_granted_scopes: "true",
      state,
      ...hint,
    })}`;
  }
  if (p === "microsoft") {
    return `https://login.microsoftonline.com/${encodeURIComponent(msTenant())}/oauth2/v2.0/authorize?${new URLSearchParams({
      client_id: msClient()!.id,
      response_type: "code",
      redirect_uri: redirectUri,
      response_mode: "query",
      scope: personal ? `openid profile ${MS_SCOPES}` : MS_SCOPES,
      prompt: "select_account",
      state,
      ...hint,
    })}`;
  }
  return `https://vercel.com/integrations/${encodeURIComponent(env("VERCEL_INTEGRATION_SLUG")!)}/new?${new URLSearchParams({ state })}`;
}

export const PROVIDER_NAMES: Record<Provider, string> = {
  github: "GitHub",
  vercel: "Vercel",
  supabase: "Supabase",
  cloudflare: "Cloudflare",
  gmail: "Google",
  microsoft: "Microsoft 365",
  stripe: "Stripe",
  hikvision: "Hikvision",
};

/** Audit entries for a new connection and any account it replaced. */
export async function auditConnection(actor: string, provider: Provider, account: string, via: "token" | "oauth", replaced: string[]) {
  const ip = await clientIp();
  await audit(actor, "connection.add", `${provider}:${account}`, { via }, ip);
  for (const old of replaced) await audit(actor, "connection.replace", `${provider}:${old}`, { by: account }, ip);
}
