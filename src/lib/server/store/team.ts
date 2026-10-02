import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { Role } from "../../access";
import { sha256Hex } from "../crypto";
import { getDb } from "../db";

// Team members live in the users table with a role. Owners configured in the
// environment have no role row and can't be changed from the UI.

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export const MIN_PASSWORD = 12;
export const INVITE_DAYS = 7;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize("NFKC"), salt, 32, SCRYPT);
  return `scrypt$${SCRYPT.N}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

// Used when the account has no password, so a wrong email takes as long as a wrong password.
const DUMMY = "scrypt$32768$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  const [kind, n, salt, hash] = (stored ?? DUMMY).split("$");
  if (kind !== "scrypt" || !salt || !hash || Number(n) !== SCRYPT.N) return false;
  const expected = Buffer.from(hash, "base64url");
  const key = await scrypt(password.normalize("NFKC"), Buffer.from(salt, "base64url"), expected.length, SCRYPT);
  return timingSafeEqual(key, expected) && !!stored;
}

export interface Member {
  email: string;
  name: string | null;
  role: Role;
  businesses: string[] | null;
  disabled: boolean;
  totpEnabled: boolean;
  hasPassword: boolean;
  invitedBy: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  /** Pending invite expiry, when one is outstanding. */
  inviteExpiresAt: string | null;
}

interface MemberRow {
  email: string;
  name: string | null;
  role: Role;
  businesses: string[] | null;
  disabled_at: Date | string | null;
  totp_enabled_at: Date | string | null;
  password_hash: string | null;
  invited_by: string | null;
  last_login_at: Date | string | null;
  created_at: Date | string;
  invite_expires_at: Date | string | null;
}

const iso = (v: Date | string | null) => (v == null ? null : new Date(v).toISOString());

const toMember = (r: MemberRow): Member => ({
  email: r.email,
  name: r.name,
  role: r.role,
  businesses: Array.isArray(r.businesses) ? r.businesses : null,
  disabled: !!r.disabled_at,
  totpEnabled: !!r.totp_enabled_at,
  hasPassword: !!r.password_hash,
  invitedBy: r.invited_by,
  lastLoginAt: iso(r.last_login_at),
  createdAt: iso(r.created_at)!,
  inviteExpiresAt: iso(r.invite_expires_at),
});

const SELECT = `select u.email, u.name, u.role, u.businesses, u.disabled_at, u.totp_enabled_at, u.password_hash, u.invited_by, u.last_login_at, u.created_at,
  (select max(i.expires_at) from invites i where i.email = u.email and i.used_at is null and i.expires_at > now()) as invite_expires_at
  from users u`;

export async function listMembers(): Promise<Member[]> {
  const db = await getDb();
  return (await db.query<MemberRow>(`${SELECT} where u.role is not null order by u.created_at`)).map(toMember);
}

export async function getMember(email: string): Promise<Member | null> {
  const db = await getDb();
  const [row] = await db.query<MemberRow>(`${SELECT} where u.email = $1 and u.role is not null`, [email]);
  return row ? toMember(row) : null;
}

export async function memberPasswordHash(email: string): Promise<string | null> {
  const db = await getDb();
  const [row] = await db.query<{ password_hash: string | null }>("select password_hash from users where email = $1 and role is not null and disabled_at is null", [email]);
  return row?.password_hash ?? null;
}

/** Whether any active member can sign in with a password (shows the email field on the login page). */
export async function anyMemberPasswords(): Promise<boolean> {
  const db = await getDb();
  const [row] = await db.query<{ n: number }>("select count(*)::int as n from users where role is not null and disabled_at is null and password_hash is not null");
  return Number(row?.n ?? 0) > 0;
}

/** Creates a fresh single-use invite link token for a member. Older unused invites stop working. */
async function newInvite(email: string, by: string): Promise<string> {
  const db = await getDb();
  const token = randomBytes(32).toString("base64url");
  await db.tx(async (tx) => {
    await tx.query("delete from invites where email = $1 and used_at is null", [email]);
    await tx.query("insert into invites (email, token_hash, created_by, expires_at) values ($1, $2, $3, now() + make_interval(days => $4))", [email, sha256Hex(token), by, INVITE_DAYS]);
  });
  return token;
}

/**
 * Adds a member (or re-adds a removed one) and returns their invite token.
 * Fails for an address that is already a member or an environment owner.
 */
export async function inviteMember(m: { email: string; name: string | null; role: Role; businesses: string[] | null; by: string }): Promise<{ token: string } | { error: string }> {
  const db = await getDb();
  const rows = await db.query<{ email: string }>(
    `insert into users (email, name, role, businesses, invited_by) values ($1, $2, $3, $4::text::jsonb, $5)
     on conflict (email) do update set name = excluded.name, role = excluded.role, businesses = excluded.businesses, invited_by = excluded.invited_by, disabled_at = null
       where users.role is null and users.totp_enabled_at is null and users.last_login_at is null
     returning email`,
    [m.email, m.name, m.role, m.businesses ? JSON.stringify(m.businesses) : null, m.by],
  );
  if (!rows.length) return { error: "That address already has an account here." };
  return { token: await newInvite(m.email, m.by) };
}

export async function reissueInvite(email: string, by: string): Promise<string | null> {
  if (!(await getMember(email))) return null;
  return newInvite(email, by);
}

export interface InviteInfo {
  email: string;
  name: string | null;
  role: Role;
  status: "ok" | "expired" | "used";
}

export async function inviteByToken(token: string): Promise<InviteInfo | null> {
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return null;
  const db = await getDb();
  const [row] = await db.query<{ email: string; name: string | null; role: Role; expired: boolean; used: boolean; disabled: boolean }>(
    `select u.email, u.name, u.role, i.expires_at <= now() as expired, i.used_at is not null as used, u.disabled_at is not null as disabled
     from invites i join users u on u.email = i.email where i.token_hash = $1 and u.role is not null`,
    [sha256Hex(token)],
  );
  if (!row || row.disabled) return null;
  return { email: row.email, name: row.name, role: row.role, status: row.used ? "used" : row.expired ? "expired" : "ok" };
}

/** Sets the member's password and uses up the invite. Returns the email, or null if the link isn't valid any more. */
export async function acceptInvite(token: string, passwordHash: string): Promise<string | null> {
  const db = await getDb();
  return db.tx(async (tx) => {
    const [inv] = await tx.query<{ email: string }>(
      `update invites set used_at = now() where token_hash = $1 and used_at is null and expires_at > now()
       and email in (select email from users where role is not null and disabled_at is null) returning email`,
      [sha256Hex(token)],
    );
    if (!inv) return null;
    // A new password signs out every existing session for this account.
    await tx.query("update users set password_hash = $2, session_version = session_version + 1 where email = $1", [inv.email, passwordHash]);
    return inv.email;
  });
}

export async function updateMember(email: string, m: { name: string | null; role: Role; businesses: string[] | null }) {
  const db = await getDb();
  // Access changes take effect on the next request (it's read per request), so sessions stay.
  const rows = await db.query("update users set name = $2, role = $3, businesses = $4::text::jsonb where email = $1 and role is not null returning email", [email, m.name, m.role, m.businesses ? JSON.stringify(m.businesses) : null]);
  return rows.length > 0;
}

export async function setMemberDisabled(email: string, disabled: boolean) {
  const db = await getDb();
  const rows = await db.query(
    `update users set disabled_at = case when $2 then now() else null end, session_version = session_version + case when $2 then 1 else 0 end
     where email = $1 and role is not null returning email`,
    [email, disabled],
  );
  // A disabled member's devices stop getting notifications.
  if (disabled) await db.query("delete from push_subscriptions where owner = $1", [email]);
  return rows.length > 0;
}

/** Removes a member's account; their tasks become unassigned. */
export async function removeMember(email: string) {
  const db = await getDb();
  const rows = await db.query("delete from users where email = $1 and role is not null returning email", [email]);
  if (rows.length) await db.query("delete from push_subscriptions where owner = $1", [email]);
  return rows.length > 0;
}
