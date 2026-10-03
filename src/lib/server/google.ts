import { createHash } from "node:crypto";
import { googleClient } from "./credentials";

// Google OAuth: one refresh token per connected Google account, exchanged for
// short-lived access tokens. Tokens are cached in memory until a minute
// before they expire, so a page view doesn't refresh once per API.

export const GOOGLE_SCOPES = {
  gmail: "https://www.googleapis.com/auth/gmail.readonly",
  // The Inbox mail client: change labels (read / unread, star, archive, trash) and send.
  gmailModify: "https://www.googleapis.com/auth/gmail.modify",
  gmailSend: "https://www.googleapis.com/auth/gmail.send",
  calendar: "https://www.googleapis.com/auth/calendar.readonly",
  analytics: "https://www.googleapis.com/auth/analytics.readonly",
  searchConsole: "https://www.googleapis.com/auth/webmasters.readonly",
} as const;

export type GoogleFeature = keyof typeof GOOGLE_SCOPES;

/**
 * Whether an account granted a feature. Accounts connected before scopes were
 * recorded (or from GMAIL_ACCOUNTS) are "unknown": we try, and a 403 tells.
 */
export function hasGoogleScope(scopes: string[] | null, feature: GoogleFeature): boolean | null {
  if (!scopes) return null;
  // Read-write access includes reading.
  if (feature === "gmail") return scopes.includes(GOOGLE_SCOPES.gmail) || scopes.includes(GOOGLE_SCOPES.gmailModify);
  return scopes.includes(GOOGLE_SCOPES[feature]);
}

const cache = new Map<string, { token: string; expires: number }>();

export async function googleAccessToken(refreshToken: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const key = createHash("sha256").update(refreshToken).digest("hex");
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.token;
  const client = googleClient();
  if (!client) throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set");
  const res = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: client.id, client_secret: client.secret, refresh_token: refreshToken, grant_type: "refresh_token" }),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error === "invalid_grant" ? "Google access was revoked or expired; reconnect this account" : `Google token refresh failed (${res.status})`);
  }
  const t = (await res.json()) as { access_token: string; expires_in?: number };
  cache.set(key, { token: t.access_token, expires: Date.now() + Math.max(60, (t.expires_in ?? 3600) - 60) * 1000 });
  return t.access_token;
}

export class GoogleApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** For accounts whose granted scopes are unknown, a 403 means "not granted", not a failure. */
export const notGrantedAsEmpty = (a: { scopes: unknown }) => (e: unknown): never[] | Promise<never> =>
  !a.scopes && e instanceof GoogleApiError && e.status === 403 ? [] : Promise.reject(e);

/** Authorized JSON call to a Google API. 403 usually means the scope wasn't granted. */
export async function googleApi<T>(token: string, url: string, init: { method?: string; body?: unknown; revalidate?: number } = {}): Promise<T> {
  const res = await fetch(url, {
    method: init.method ?? "GET",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}) },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
    // Access tokens change hourly, so the token-keyed fetch cache can't help; data is cached per call site.
    cache: "no-store",
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new GoogleApiError(res.status, `${res.status} from ${new URL(url).host}: ${body.error?.message ?? res.statusText}`);
  }
  return res.json() as Promise<T>;
}
