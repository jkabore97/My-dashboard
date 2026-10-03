import { getDb } from "../db";
import { decryptJson, encryptJson } from "../crypto";

export type Provider = "github" | "vercel" | "supabase" | "cloudflare" | "gmail" | "stripe" | "microsoft" | "hikvision" | "msadmin" | "gcloud";

/** Providers that keep several accounts side by side (one per mailbox / business). */
export const MULTI_ACCOUNT: Provider[] = ["gmail", "stripe", "microsoft", "hikvision"];

export interface Connection<S = Record<string, string>> {
  id: string;
  provider: Provider;
  account: string;
  label: string | null;
  business: string | null;
  meta: Record<string, unknown>;
  createdAt: string;
  /** Whose own mailbox / calendar this is; null = shared (connected on the Platforms page). */
  ownerEmail: string | null;
  secret: S;
}

interface Row {
  id: string;
  provider: Provider;
  account: string;
  label: string | null;
  business: string | null;
  secret: string;
  meta: Record<string, unknown>;
  created_at: Date | string;
  owner_email: string | null;
}

export async function listConnections<S = Record<string, string>>(provider?: Provider): Promise<Connection<S>[]> {
  return (await readConnections<S>(provider)).list;
}

/** Decrypted connections, plus the rows that couldn't be decrypted (ENCRYPTION_KEY changed); their account is plaintext. */
export async function readConnections<S = Record<string, string>>(provider?: Provider) {
  const db = await getDb();
  const rows = provider
    ? await db.query<Row>("select * from connections where provider = $1 order by created_at", [provider])
    : await db.query<Row>("select * from connections order by provider, created_at");
  const undecryptable: { provider: Provider; account: string; ownerEmail: string | null }[] = [];
  const list = rows.flatMap((r): Connection<S>[] => {
    try {
      return [{ id: r.id, provider: r.provider, account: r.account, label: r.label, business: r.business, meta: r.meta ?? {}, createdAt: new Date(r.created_at).toISOString(), ownerEmail: r.owner_email ?? null, secret: decryptJson<S>(r.secret) }];
    } catch {
      undecryptable.push({ provider: r.provider, account: r.account, ownerEmail: r.owner_email ?? null });
      return [];
    }
  });
  return { list, undecryptable };
}

/** Lists shared connections without decrypting secrets — for display only. Personal ones are listed apart (listPersonalSummaries). */
export async function listConnectionSummaries() {
  const db = await getDb();
  const rows = await db.query<Omit<Row, "secret">>("select id, provider, account, label, business, meta, created_at, owner_email from connections where owner_email is null order by provider, created_at");
  return rows.map((r) => ({
    id: r.id,
    provider: r.provider,
    account: r.account,
    label: r.label,
    business: r.business,
    createdAt: new Date(r.created_at).toISOString(),
    /** OAuth scopes granted, when recorded (Google). */
    scopes: Array.isArray(r.meta?.scopes) ? (r.meta.scopes as string[]) : null,
    /** Google Cloud: the BigQuery billing-export table (not a secret). */
    exportTable: typeof r.meta?.exportTable === "string" ? r.meta.exportTable : null,
  }));
}

export interface PersonalSummary {
  id: string;
  provider: Provider;
  account: string;
  ownerEmail: string;
  createdAt: string;
  scopes: string[] | null;
}

/** Personal mailboxes / calendars (no secrets): everyone's (owner, for the Platforms page) or one person's. */
export async function listPersonalSummaries(ownerEmail?: string): Promise<PersonalSummary[]> {
  const db = await getDb();
  const rows = await db.query<Omit<Row, "secret">>(
    "select id, provider, account, label, business, meta, created_at, owner_email from connections where owner_email is not null and ($1::text is null or owner_email = $1) order by owner_email, provider, created_at",
    [ownerEmail ?? null],
  );
  return rows.map((r) => ({ id: r.id, provider: r.provider, account: r.account, ownerEmail: r.owner_email!, createdAt: new Date(r.created_at).toISOString(), scopes: Array.isArray(r.meta?.scopes) ? (r.meta.scopes as string[]) : null }));
}

/** Thrown when an account is already connected for someone else (or as a shared one). */
export class AccountTaken extends Error {}

/**
 * Stores a connection. Gmail keeps one per mailbox; every other provider has
 * a single active account, so connecting another replaces the old one(s).
 * Returns the accounts that were replaced.
 *
 * `ownerEmail` makes it someone's personal mailbox / calendar. An account
 * stays what it was first connected as: a shared account can't become
 * personal (or someone else's) and the other way round; that throws AccountTaken.
 */
export async function saveConnection(c: { provider: Provider; account: string; label?: string | null; business?: string | null; secret: unknown; meta?: Record<string, unknown>; ownerEmail?: string | null }) {
  const db = await getDb();
  const owner = c.ownerEmail ?? null;
  return db.tx(async (tx) => {
    const saved = await tx.query(
      `insert into connections (provider, account, label, business, secret, meta, owner_email) values ($1, $2, $3, $4, $5, $6::text::jsonb, $7)
       on conflict (provider, account) do update set label = coalesce(excluded.label, connections.label),
         business = coalesce(excluded.business, connections.business), secret = excluded.secret, meta = excluded.meta, updated_at = now()
         where connections.owner_email is not distinct from excluded.owner_email
       returning id`,
      [c.provider, c.account, c.label ?? null, owner ? null : (c.business ?? null), encryptJson(c.secret), JSON.stringify(c.meta ?? {}), owner],
    );
    if (!saved.length) throw new AccountTaken(`${c.account} is already connected${owner ? " by someone else, or as a shared account" : " as someone's personal mailbox"}.`);
    if (owner || MULTI_ACCOUNT.includes(c.provider)) return [];
    const removed = await tx.query<{ account: string }>("delete from connections where provider = $1 and account <> $2 and owner_email is null returning account", [c.provider, c.account]);
    return removed.map((r) => r.account);
  });
}

/** Replaces a connection's secret in place (e.g. a rotated refresh token). */
export async function updateConnectionSecret(provider: Provider, account: string, secret: unknown) {
  const db = await getDb();
  await db.query("update connections set secret = $3, updated_at = now() where provider = $1 and account = $2", [provider, account, encryptJson(secret)]);
}

/** Relabels a shared connection (personal ones have no label or business). */
export async function updateConnectionLabel(id: string, label: string | null, business: string | null) {
  const db = await getDb();
  await db.query("update connections set label = $2, business = $3, updated_at = now() where id = $1 and owner_email is null", [id, label, business]);
}

/**
 * Deletes a connection. `scope` limits which: "shared" (Platforms page),
 * a person's email (their own personal one), or "personal" (the owner
 * removing anyone's personal mailbox from the Platforms page).
 */
export async function deleteConnection(id: string, scope: "shared" | "personal" | { ownerEmail: string } = "shared") {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const db = await getDb();
  const where = scope === "shared" ? "owner_email is null" : scope === "personal" ? "owner_email is not null" : "owner_email = $2";
  const rows = await db.query<{ provider: string; account: string; owner_email: string | null }>(
    `delete from connections where id = $1 and ${where} returning provider, account, owner_email`,
    typeof scope === "object" ? [id, scope.ownerEmail] : [id],
  );
  const gone = rows[0];
  if (gone?.owner_email) {
    // Claude's readings of that mailbox's messages (ids are "<mailbox>:<message>") go with it.
    const prefix = `${gone.provider === "microsoft" ? `ms:${gone.account}` : gone.account}:`;
    await db.query("delete from email_triage where private_to = $1 and left(message_id, length($2)) = $2", [gone.owner_email, prefix]);
  }
  return gone ?? null;
}
