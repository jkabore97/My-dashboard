import { createHash } from "node:crypto";
import { msClient, msTenant } from "./microsoft";
import { updateConnectionSecret } from "./store/connections";

// Microsoft 365 admin: a separate, owner-only connection on the same Entra
// app as the mailboxes. One delegated sign-in grants Graph (licences, service
// health) and Azure Service Management (billing). Entra refresh tokens are
// not tied to one resource, so the same token is redeemed for each.

export const GRAPH_ADMIN_SCOPES = "https://graph.microsoft.com/Organization.Read.All https://graph.microsoft.com/ServiceHealth.Read.All https://graph.microsoft.com/User.Read";
export const ARM_SCOPE = "https://management.azure.com/user_impersonation";

/** Asked for at sign-in: Graph plus ARM consent ("extra scopes to consent"); the code itself is redeemed for Graph. */
export const MSADMIN_AUTHORIZE_SCOPES = `openid profile offline_access ${GRAPH_ADMIN_SCOPES} ${ARM_SCOPE}`;

export type MsResource = "graph" | "arm";
const SCOPE: Record<MsResource, string> = { graph: `offline_access ${GRAPH_ADMIN_SCOPES}`, arm: `offline_access ${ARM_SCOPE}` };

export const msTokenUrl = () => `https://login.microsoftonline.com/${encodeURIComponent(msTenant())}/oauth2/v2.0/token`;

export function msAdminAuthorizeUrl(redirectUri: string, state: string, step: "graph" | "arm", loginHint?: string): string {
  return `https://login.microsoftonline.com/${encodeURIComponent(msTenant())}/oauth2/v2.0/authorize?${new URLSearchParams({
    client_id: msClient()!.id,
    response_type: "code",
    redirect_uri: redirectUri,
    response_mode: "query",
    scope: step === "graph" ? MSADMIN_AUTHORIZE_SCOPES : `openid profile offline_access ${ARM_SCOPE}`,
    prompt: step === "graph" ? "select_account" : "consent",
    state,
    ...(loginHint && /^[^\s@]{1,64}@[^\s@]{1,190}$/.test(loginHint) ? { login_hint: loginHint } : {}),
  })}`;
}

export class MsTokenError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

/** Redeems a refresh token for one resource. Throws MsTokenError with Entra's error text (no secrets in it). */
export async function redeemRefreshToken(refreshToken: string, resource: MsResource): Promise<{ accessToken: string; refreshToken: string | null; expiresIn: number }> {
  const client = msClient();
  if (!client) throw new MsTokenError("not_configured", "MS_CLIENT_ID / MS_CLIENT_SECRET are not set");
  const res = await fetch(msTokenUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ client_id: client.id, client_secret: client.secret, refresh_token: refreshToken, grant_type: "refresh_token", scope: SCOPE[resource] }),
    cache: "no-store",
  });
  const t = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || !t.access_token) throw new MsTokenError(t.error ?? String(res.status), `${t.error ?? res.status}: ${(t.error_description ?? "").split("\r\n")[0].slice(0, 240)}`);
  return { accessToken: t.access_token, refreshToken: t.refresh_token ?? null, expiresIn: t.expires_in ?? 3600 };
}

const cache = new Map<string, { token: string; expires: number }>();
const inFlight = new Map<string, Promise<string>>();

/** An access token for the admin connection, for Graph or ARM. Rotated refresh tokens are saved. */
export async function msAdminToken(conn: { account: string; refreshToken: string }, resource: MsResource): Promise<string> {
  const key = createHash("sha256").update(`${conn.account}:${resource}`).digest("hex");
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.token;
  const pending = inFlight.get(key);
  if (pending) return pending;
  const p = (async () => {
    const t = await redeemRefreshToken(conn.refreshToken, resource);
    if (t.refreshToken && t.refreshToken !== conn.refreshToken) {
      conn.refreshToken = t.refreshToken;
      await updateConnectionSecret("msadmin", conn.account, { refreshToken: t.refreshToken }).catch(() => {});
    }
    cache.set(key, { token: t.accessToken, expires: Date.now() + Math.max(60, t.expiresIn - 60) * 1000 });
    return t.accessToken;
  })().finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}

/** Tests: forget cached tokens. */
export const forgetMsAdminTokens = () => cache.clear();

export class ArmError extends Error {
  constructor(public status: number, public code: string | undefined, message: string) {
    super(message);
  }
}

/** GET on Azure Resource Manager. */
export async function armGet<T>(token: string, pathOrUrl: string): Promise<T> {
  const url = pathOrUrl.startsWith("https://management.azure.com/") ? pathOrUrl : `https://management.azure.com${pathOrUrl}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, cache: "no-store" });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
    throw new ArmError(res.status, body.error?.code, `${res.status} from Azure billing${body.error?.code ? ` (${body.error.code})` : ""}`);
  }
  return res.json() as Promise<T>;
}
