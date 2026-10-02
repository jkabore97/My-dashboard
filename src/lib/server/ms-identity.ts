// Who a Microsoft sign-in is. Pure, so the rules are unit-tested.
//
// The email claim of a Microsoft token can be set by the admin of any tenant,
// so it is never used. The identity is preferred_username: for work and school
// accounts that is the UPN, whose domain the tenant must have verified; for
// personal Microsoft accounts it is the account's own, verified address. The
// account's stable id (tid:oid) is also pinned on first sign-in, so a later
// sign-in under the same name from a different account is refused.

export const CONSUMER_TENANT = "9188040d-6c67-4c5b-b112-36a304b66dad";
const MULTI = new Set(["common", "organizations", "consumers"]);

export interface MsClaims {
  tid?: string;
  oid?: string;
  sub?: string;
  preferred_username?: string;
  email?: string;
  name?: string;
}

/** Decodes a JWT's payload. Only for tokens received straight from Microsoft's token endpoint over TLS. */
export function decodeJwtPayload(token: string): MsClaims | null {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as MsClaims;
  } catch {
    return null;
  }
}

/**
 * The identity behind a sign-in, or why it's refused. `tenant` is the
 * authority used (a tenant ID or domain, or common/organizations/consumers);
 * `expectedTid` is that tenant's ID when known.
 */
export function msIdentity(c: MsClaims, opts: { tenant: string; expectedTid?: string | null }): { email: string; subject: string; name: string | null } | { error: string } {
  const email = c.preferred_username?.trim().toLowerCase();
  if (!c.tid || !c.oid || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Microsoft didn't return a usable account name." };
  // Guest accounts carry a tenant-made name like user_gmail.com#EXT#@tenant.onmicrosoft.com.
  if (email.includes("#ext#")) return { error: "Sign in with your own Microsoft account, not a guest account." };
  if (!MULTI.has(opts.tenant.toLowerCase()) && opts.expectedTid && c.tid !== opts.expectedTid) return { error: "That account belongs to a different organization." };
  return { email, subject: `${c.tid}:${c.oid}`, name: c.name?.trim().slice(0, 80) || null };
}
