import { createHash } from "node:crypto";
import { callSignal, env } from "../source";
import { updateConnectionMeta, updateConnectionSecret } from "./store/connections";

// Microsoft 365 (Outlook mail + calendar) through Microsoft Graph. Refresh
// tokens rotate: every refresh returns a new one, which is saved (encrypted)
// so the connection keeps working.

/**
 * Mailbox connections (shared and personal): read and change mail, send as
 * the mailbox, read calendars. Mail.ReadWrite and Mail.Send are delegated
 * permissions on the Entra app (docs/CONNECT.md).
 */
export const MS_SCOPES = "offline_access User.Read Mail.ReadWrite Mail.Send Calendars.Read";
/** What mailboxes connected before replying existed were granted; their refresh tokens fall back to it. */
export const MS_READ_SCOPES = "offline_access User.Read Mail.Read Calendars.Read";
export const msTenant = () => env("MS_TENANT_ID") ?? "common";
export const msClient = () => {
  const id = env("MS_CLIENT_ID");
  const secret = env("MS_CLIENT_SECRET");
  return id && secret ? { id, secret } : null;
};

interface CachedToken {
  token: string;
  expires: number;
  /** Scopes the token was granted (from the token response), when Microsoft said. */
  scopes: string[] | null;
  /** Refresh tokens (hashed) this entry stands for: the one used and the one it rotated to. A reconnected account misses. */
  from: string[];
}

const cache = new Map<string, CachedToken>();
// Mail and calendar load in parallel; they share one refresh per account
// instead of each rotating the refresh token.
const inFlight = new Map<string, Promise<CachedToken>>();
// Refresh tokens (by hash) that weren't consented for write / send: refreshed
// with the read-only scopes until the mailbox is reconnected.
const readOnly = new Set<string>();

export interface MsTokenAccount {
  account: string;
  refreshToken: string;
  /** Scopes recorded on the connection, if any (kept up to date after refreshes). */
  scopes?: string[] | null;
}

export async function msAccessToken(account: MsTokenAccount): Promise<string> {
  return (await msToken(account)).token;
}

/** An access token and the scopes Microsoft granted it. */
export async function msToken(account: MsTokenAccount): Promise<{ token: string; scopes: string[] | null }> {
  const key = createHash("sha256").update(account.account).digest("hex");
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now() && hit.from.includes(hashOf(account.refreshToken))) return hit;
  const pending = inFlight.get(key);
  if (pending) return pending;
  const p = refresh(key, account).finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}

type TokenReply = { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string; error_description?: string; error_codes?: number[] };

/** A refresh refused because the token wasn't granted what was asked (as opposed to a revoked token or an outage). */
export const scopeRefused = (t: TokenReply) =>
  t.error === "invalid_grant" || t.error === "invalid_scope" || t.error === "consent_required" || t.error === "interaction_required" || (t.error_codes ?? []).some((c) => c === 65001 || c === 70000 || c === 70011);

async function tokenRequest(client: { id: string; secret: string }, refreshToken: string, scope: string) {
  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(msTenant())}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: client.id, client_secret: client.secret, refresh_token: refreshToken, grant_type: "refresh_token", scope }),
    cache: "no-store",
  });
  return { ok: res.ok, t: (await res.json().catch(() => ({}))) as TokenReply, status: res.status };
}

async function refresh(key: string, account: MsTokenAccount): Promise<CachedToken> {
  const client = msClient();
  if (!client) throw new Error("MS_CLIENT_ID / MS_CLIENT_SECRET are not set");
  const rtKey = hashOf(account.refreshToken);
  // Ask for write + send first: a mailbox connected before they were added
  // gets them as soon as an admin consents for the organisation. If Microsoft
  // refuses, fall back to what it was connected with (and remember that).
  let r = await tokenRequest(client, account.refreshToken, readOnly.has(rtKey) ? MS_READ_SCOPES : MS_SCOPES);
  if ((!r.ok || !r.t.access_token) && !readOnly.has(rtKey) && scopeRefused(r.t)) {
    const legacy = await tokenRequest(client, account.refreshToken, MS_READ_SCOPES);
    if (legacy.ok && legacy.t.access_token) readOnly.add(rtKey);
    r = legacy;
  }
  const t = r.t;
  if (!r.ok || !t.access_token) {
    throw new Error(t.error === "invalid_grant" ? "Microsoft access was revoked or expired; reconnect this account" : `Microsoft token refresh failed (${t.error ?? r.status})`);
  }
  const from = [rtKey];
  if (t.refresh_token && t.refresh_token !== account.refreshToken) {
    from.push(hashOf(t.refresh_token));
    if (readOnly.has(rtKey)) readOnly.add(hashOf(t.refresh_token));
    await updateConnectionSecret("microsoft", account.account, { refreshToken: t.refresh_token }).catch(() => {});
  }
  const scopes = t.scope ? t.scope.split(/\s+/).filter(Boolean) : null;
  // Record what was granted, so Platforms and the Inbox can say "reconnect to enable replying".
  if (scopes && !sameScopes(scopes, account.scopes ?? null)) {
    await updateConnectionMeta("microsoft", account.account, { scopes }).catch(() => {});
  }
  const entry = { token: t.access_token, expires: Date.now() + Math.max(60, (t.expires_in ?? 3600) - 60) * 1000, scopes, from };
  cache.set(key, entry);
  return entry;
}

const hashOf = (s: string) => createHash("sha256").update(s).digest("hex");
const sameScopes = (a: string[], b: string[] | null) => !!b && a.length === b.length && [...a].sort().join(" ") === [...b].sort().join(" ");

/** Tests: forget cached tokens. */
export function forgetMsTokens() {
  cache.clear();
  readOnly.clear();
}

export async function graph<T>(token: string, path: string, headers: Record<string, string> = {}, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...headers },
    cache: "no-store",
    // A slow mailbox or admin API never holds a refresh for long.
    signal: callSignal(15_000, signal),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(`${res.status} from Microsoft Graph: ${body.error?.message ?? res.statusText}`);
  }
  return res.json() as Promise<T>;
}
