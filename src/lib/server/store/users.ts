import { getDb } from "../db";

export interface UserRow {
  email: string;
  totp_secret: string | null;
  totp_pending_secret: string | null;
  totp_enabled_at: Date | string | null;
  totp_last_step: string | number | null;
  recovery_codes: string[];
  session_version: number;
}

export async function getUser(email: string): Promise<UserRow | null> {
  const db = await getDb();
  const [row] = await db.query<UserRow>("select * from users where email = $1", [email]);
  return row ?? null;
}

export async function ensureUser(email: string): Promise<UserRow> {
  const db = await getDb();
  const [row] = await db.query<UserRow>(
    `insert into users (email) values ($1) on conflict (email) do update set last_login_at = now() returning *`,
    [email],
  );
  return row;
}

export async function setPendingTotp(email: string, encryptedSecret: string) {
  const db = await getDb();
  await db.query("update users set totp_pending_secret = $2 where email = $1", [email, encryptedSecret]);
}

export async function enableTotp(email: string, encryptedSecret: string, step: number, recoveryHashes: string[]) {
  const db = await getDb();
  await db.query(
    `update users set totp_secret = $2, totp_pending_secret = null, totp_enabled_at = now(), totp_last_step = $3,
       recovery_codes = $4::text::jsonb where email = $1`,
    [email, encryptedSecret, step, JSON.stringify(recoveryHashes)],
  );
}

/** Records the accepted TOTP step; fails (returns false) if a newer one was already used. */
export async function markTotpStep(email: string, step: number): Promise<boolean> {
  const db = await getDb();
  const rows = await db.query(
    "update users set totp_last_step = $2 where email = $1 and (totp_last_step is null or totp_last_step < $2) returning email",
    [email, step],
  );
  return rows.length > 0;
}

/** Removes one recovery code hash; returns false if it wasn't there. */
export async function consumeRecoveryCode(email: string, hash: string): Promise<boolean> {
  const db = await getDb();
  const rows = await db.query(
    `update users set recovery_codes = recovery_codes - $2 where email = $1 and recovery_codes ? $2 returning email`,
    [email, hash],
  );
  return rows.length > 0;
}

export async function setRecoveryCodes(email: string, hashes: string[]) {
  const db = await getDb();
  await db.query("update users set recovery_codes = $2::text::jsonb where email = $1", [email, JSON.stringify(hashes)]);
}

export async function bumpSessionVersion(email: string) {
  const db = await getDb();
  const [row] = await db.query<{ session_version: number }>(
    "update users set session_version = session_version + 1 where email = $1 returning session_version",
    [email],
  );
  return row?.session_version ?? 1;
}

export async function resetTotp(email: string) {
  const db = await getDb();
  await db.query(
    "update users set totp_secret = null, totp_pending_secret = null, totp_enabled_at = null, totp_last_step = null, recovery_codes = '[]'::jsonb where email = $1",
    [email],
  );
}
