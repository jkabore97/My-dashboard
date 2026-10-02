import { createHash, randomBytes } from "node:crypto";

// HTTP Digest authentication (RFC 7616, MD5 + qop=auth), which Hikvision
// ISAPI uses. The first request gets a 401 with a challenge; the second
// carries the computed response.

const md5 = (s: string) => createHash("md5").update(s).digest("hex");

export function parseChallenge(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of header.replace(/^Digest\s+/i, "").matchAll(/(\w+)=(?:"([^"]*)"|([^,\s]*))/g)) out[m[1].toLowerCase()] = m[2] ?? m[3];
  return out;
}

export function digestHeader(p: { username: string; password: string; method: string; uri: string; challenge: Record<string, string>; cnonce?: string; nc?: string }) {
  const { realm = "", nonce = "", qop, opaque, algorithm } = p.challenge;
  const cnonce = p.cnonce ?? randomBytes(8).toString("hex");
  const nc = p.nc ?? "00000001";
  const ha1 = md5(`${p.username}:${realm}:${p.password}`);
  const ha2 = md5(`${p.method}:${p.uri}`);
  const useQop = qop?.split(",").map((q) => q.trim()).includes("auth") ? "auth" : null;
  const response = useQop ? md5(`${ha1}:${nonce}:${nc}:${cnonce}:${useQop}:${ha2}`) : md5(`${ha1}:${nonce}:${ha2}`);
  const parts = [`username="${p.username}"`, `realm="${realm}"`, `nonce="${nonce}"`, `uri="${p.uri}"`, `response="${response}"`];
  if (algorithm) parts.push(`algorithm=${algorithm}`);
  if (opaque) parts.push(`opaque="${opaque}"`);
  if (useQop) parts.push(`qop=${useQop}`, `nc=${nc}`, `cnonce="${cnonce}"`);
  return `Digest ${parts.join(", ")}`;
}

/** fetch() with Digest auth: one unauthenticated try, then the authenticated retry. */
export async function digestFetch(url: string, creds: { username: string; password: string }, init: RequestInit & { headers?: Record<string, string> } = {}): Promise<Response> {
  const first = await fetch(url, { ...init, cache: "no-store", redirect: "manual" });
  if (first.status !== 401) return first;
  const challenge = first.headers.get("www-authenticate");
  await first.body?.cancel().catch(() => {});
  if (!challenge || !/^Digest/i.test(challenge)) return first;
  const u = new URL(url);
  const authorization = digestHeader({ ...creds, method: (init.method ?? "GET").toUpperCase(), uri: u.pathname + u.search, challenge: parseChallenge(challenge) });
  return fetch(url, { ...init, cache: "no-store", redirect: "manual", headers: { ...(init.headers ?? {}), Authorization: authorization } });
}
