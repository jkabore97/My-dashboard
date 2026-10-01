import { getDb } from "../db";

export async function audit(actor: string, action: string, target?: string | null, detail?: unknown, ip?: string | null) {
  const db = await getDb();
  await db.query("insert into audit_log (actor, action, target, detail, ip) values ($1, $2, $3, $4::text::jsonb, $5)", [
    actor,
    action,
    target ?? null,
    detail === undefined ? null : JSON.stringify(detail),
    ip ?? null,
  ]);
}

export async function listAudit(limit = 100) {
  const db = await getDb();
  const rows = await db.query<{ id: string; actor: string; action: string; target: string | null; detail: unknown; ip: string | null; at: Date | string }>(
    "select * from audit_log order by at desc, id desc limit $1",
    [limit],
  );
  return rows.map((r) => ({ ...r, id: String(r.id), at: new Date(r.at).toISOString() }));
}
