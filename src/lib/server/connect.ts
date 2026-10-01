import { env } from "../source";
import type { Provider } from "./store/connections";

// OAuth "Connect" flows for platforms whose data the dashboard reads.
export type OAuthProvider = "github" | "gmail" | "vercel";

export function oauthConfigured(p: OAuthProvider): boolean {
  if (p === "github") return !!(env("GITHUB_OAUTH_CLIENT_ID") && env("GITHUB_OAUTH_CLIENT_SECRET"));
  if (p === "gmail") return !!(env("GOOGLE_CLIENT_ID") && env("GOOGLE_CLIENT_SECRET"));
  return !!(env("VERCEL_INTEGRATION_SLUG") && env("VERCEL_CLIENT_ID") && env("VERCEL_CLIENT_SECRET"));
}

export const isOAuthProvider = (p: string): p is OAuthProvider => p === "github" || p === "gmail" || p === "vercel";

export function authorizeUrl(p: OAuthProvider, redirectUri: string, state: string): string {
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
      scope: "openid email https://www.googleapis.com/auth/gmail.readonly",
      access_type: "offline",
      prompt: "consent select_account",
      include_granted_scopes: "true",
      state,
    })}`;
  }
  return `https://vercel.com/integrations/${encodeURIComponent(env("VERCEL_INTEGRATION_SLUG")!)}/new?${new URLSearchParams({ state })}`;
}

export const PROVIDER_NAMES: Record<Provider, string> = {
  github: "GitHub",
  vercel: "Vercel",
  supabase: "Supabase",
  cloudflare: "Cloudflare",
  gmail: "Gmail",
};
