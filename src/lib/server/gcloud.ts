import { createHash, sign } from "node:crypto";
import { GCP_SCOPES, type ServiceAccountKey } from "../billing/google";

// Google Cloud with a service-account key: a self-signed RS256 JWT is
// exchanged at Google's token endpoint for a one-hour access token
// (RFC 7523 JWT bearer grant). The private key never leaves the server and
// never appears in errors or logs.

export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

const b64url = (v: Buffer | string) => Buffer.from(v).toString("base64url");

/** The signed assertion for the token endpoint. */
export function signServiceAccountJwt(key: Pick<ServiceAccountKey, "clientEmail" | "privateKey" | "privateKeyId">, scopes: string[] = GCP_SCOPES, nowSec = Math.floor(Date.now() / 1000)): string {
  const header = { alg: "RS256", typ: "JWT", ...(key.privateKeyId ? { kid: key.privateKeyId } : {}) };
  const claims = { iss: key.clientEmail, scope: scopes.join(" "), aud: GOOGLE_TOKEN_URL, iat: nowSec, exp: nowSec + 3600 };
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const signature = sign("RSA-SHA256", Buffer.from(input), key.privateKey);
  return `${input}.${b64url(signature)}`;
}

/** Exchanges the assertion; the error says what Google said, never the key. */
export async function exchangeJwt(assertion: string): Promise<{ accessToken: string; expiresIn: number }> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
    cache: "no-store",
  });
  const t = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!res.ok || !t.access_token) {
    const why = t.error === "invalid_grant" ? "the key was deleted, disabled or is for another account" : (t.error_description ?? t.error ?? String(res.status));
    throw new Error(`Google rejected the service-account key (${why.slice(0, 200)})`);
  }
  return { accessToken: t.access_token, expiresIn: t.expires_in ?? 3600 };
}

const cache = new Map<string, { token: string; expires: number }>();

export async function gcpAccessToken(key: Pick<ServiceAccountKey, "clientEmail" | "privateKey" | "privateKeyId">): Promise<string> {
  const id = createHash("sha256").update(`${key.clientEmail}:${key.privateKeyId ?? ""}:${createHash("sha256").update(key.privateKey).digest("hex")}`).digest("hex");
  const hit = cache.get(id);
  if (hit && hit.expires > Date.now()) return hit.token;
  const t = await exchangeJwt(signServiceAccountJwt(key));
  cache.set(id, { token: t.accessToken, expires: Date.now() + Math.max(60, t.expiresIn - 120) * 1000 });
  return t.accessToken;
}

export const forgetGcpTokens = () => cache.clear();

export class GcpApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Authorized JSON call to a Google Cloud API. */
export async function gcpApi<T>(token: string, url: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(url, {
    method: init.method ?? "GET",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}) },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new GcpApiError(res.status, `${res.status} from ${new URL(url).host}: ${(body.error?.message ?? res.statusText).slice(0, 240)}`);
  }
  return res.json() as Promise<T>;
}
