import { createHash } from "node:crypto";
import { callSignal, env } from "../source";
import { updateConnectionSecret } from "./store/connections";

// Microsoft 365 (Outlook mail + calendar) through Microsoft Graph. Refresh
// tokens rotate: every refresh returns a new one, which is saved (encrypted)
// so the connection keeps working.

export const MS_SCOPES = "offline_access User.Read Mail.Read Calendars.Read";
export const msTenant = () => env("MS_TENANT_ID") ?? "common";
export const msClient = () => {
  const id = env("MS_CLIENT_ID");
  const secret = env("MS_CLIENT_SECRET");
  return id && secret ? { id, secret } : null;
};

const cache = new Map<string, { token: string; expires: number }>();
// Mail and calendar load in parallel; they share one refresh per account
// instead of each rotating the refresh token.
const inFlight = new Map<string, Promise<string>>();

export async function msAccessToken(account: { account: string; refreshToken: string }): Promise<string> {
  const key = createHash("sha256").update(account.account).digest("hex");
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.token;
  const pending = inFlight.get(key);
  if (pending) return pending;
  const p = refresh(key, account).finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}

async function refresh(key: string, account: { account: string; refreshToken: string }): Promise<string> {
  const client = msClient();
  if (!client) throw new Error("MS_CLIENT_ID / MS_CLIENT_SECRET are not set");
  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(msTenant())}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: client.id, client_secret: client.secret, refresh_token: account.refreshToken, grant_type: "refresh_token", scope: MS_SCOPES }),
    cache: "no-store",
  });
  const t = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!res.ok || !t.access_token) {
    throw new Error(t.error === "invalid_grant" ? "Microsoft access was revoked or expired; reconnect this account" : `Microsoft token refresh failed (${t.error ?? res.status})`);
  }
  if (t.refresh_token && t.refresh_token !== account.refreshToken) {
    await updateConnectionSecret("microsoft", account.account, { refreshToken: t.refresh_token }).catch(() => {});
  }
  cache.set(key, { token: t.access_token, expires: Date.now() + Math.max(60, (t.expires_in ?? 3600) - 60) * 1000 });
  return t.access_token;
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
