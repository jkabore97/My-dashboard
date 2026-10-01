import { getDb } from "../db";
import { decryptJson, encryptJson } from "../crypto";

export type Provider = "github" | "vercel" | "supabase" | "cloudflare" | "gmail";

export interface Connection<S = Record<string, string>> {
  id: string;
  provider: Provider;
  account: string;
  label: string | null;
  business: string | null;
  meta: Record<string, unknown>;
  createdAt: string;
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
}

export async function listConnections<S = Record<string, string>>(provider?: Provider): Promise<Connection<S>[]> {
  const db = await getDb();
  const rows = provider
    ? await db.query<Row>("select * from connections where provider = $1 order by created_at", [provider])
    : await db.query<Row>("select * from connections order by provider, created_at");
  return rows.flatMap((r) => {
    try {
      return [{ id: r.id, provider: r.provider, account: r.account, label: r.label, business: r.business, meta: r.meta ?? {}, createdAt: new Date(r.created_at).toISOString(), secret: decryptJson<S>(r.secret) }];
    } catch {
      // Undecryptable (ENCRYPTION_KEY changed): treat as disconnected.
      return [];
    }
  });
}

/** Lists connections without decrypting secrets — for display only. */
export async function listConnectionSummaries() {
  const db = await getDb();
  const rows = await db.query<Omit<Row, "secret">>("select id, provider, account, label, business, meta, created_at from connections order by provider, created_at");
  return rows.map((r) => ({ id: r.id, provider: r.provider, account: r.account, label: r.label, business: r.business, createdAt: new Date(r.created_at).toISOString() }));
}

export async function saveConnection(c: { provider: Provider; account: string; label?: string | null; business?: string | null; secret: unknown; meta?: Record<string, unknown> }) {
  const db = await getDb();
  await db.query(
    `insert into connections (provider, account, label, business, secret, meta) values ($1, $2, $3, $4, $5, $6::text::jsonb)
     on conflict (provider, account) do update set label = coalesce(excluded.label, connections.label),
       business = coalesce(excluded.business, connections.business), secret = excluded.secret, meta = excluded.meta, updated_at = now()`,
    [c.provider, c.account, c.label ?? null, c.business ?? null, encryptJson(c.secret), JSON.stringify(c.meta ?? {})],
  );
}

export async function updateConnectionLabel(id: string, label: string | null, business: string | null) {
  const db = await getDb();
  await db.query("update connections set label = $2, business = $3, updated_at = now() where id = $1", [id, label, business]);
}

export async function deleteConnection(id: string) {
  const db = await getDb();
  const rows = await db.query<{ provider: string; account: string }>("delete from connections where id = $1 returning provider, account", [id]);
  return rows[0] ?? null;
}
