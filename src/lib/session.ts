// Signed session cookies. Uses only Web Crypto so it runs in the proxy as well
// as in server code. A session is either "full" (signed in, 2FA satisfied or
// not required) or "pending" (first factor passed, 2FA still owed).
export const SESSION_COOKIE = "kcc_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
export const PENDING_TTL_SECONDS = 60 * 10;

export interface SessionPayload {
  sub: string;
  stage: "full" | "pending";
  sv: number;
  /** How this session signed in (microsoft, google, password); absent on sessions from before it was recorded. */
  m?: string;
  iat: number;
  exp: number;
}

const enc = new TextEncoder();

function b64url(bytes: Uint8Array) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string) {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export function sessionSecret(): string | null {
  const s = process.env.SESSION_SECRET?.trim();
  if (s && s.length >= 32) return s;
  if (process.env.NODE_ENV === "production") return null;
  return "kcc-insecure-development-session-secret";
}

async function hmacKey(secret: string) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function signSession(payload: Omit<SessionPayload, "iat" | "exp">, ttlSeconds: number, secret: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const body = b64url(enc.encode(JSON.stringify({ ...payload, iat: now, exp: now + ttlSeconds })));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(body)));
  return `${body}.${b64url(sig)}`;
}

export async function verifySession(token: string | undefined, secret: string): Promise<SessionPayload | null> {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), fromB64url(sig), enc.encode(body));
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(fromB64url(body))) as SessionPayload;
    if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (payload.stage !== "full" && payload.stage !== "pending") return null;
    return payload;
  } catch {
    return null;
  }
}
