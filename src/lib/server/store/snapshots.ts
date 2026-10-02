import { getDb } from "../db";

export async function recordSnapshot(kind: string, key: string, data: unknown) {
  const db = await getDb();
  await db.query("insert into snapshots (kind, key, data) values ($1, $2, $3::text::jsonb)", [kind, key, JSON.stringify(data)]);
}

export async function latestSnapshot<T>(kind: string, key: string): Promise<T | null> {
  const db = await getDb();
  const [row] = await db.query<{ data: T }>(
    "select data from snapshots where kind = $1 and key = $2 order by taken_at desc, id desc limit 1",
    [kind, key],
  );
  return row?.data ?? null;
}

export async function snapshotHistory<T>(kind: string, sinceHours: number): Promise<{ key: string; data: T; takenAt: string }[]> {
  const db = await getDb();
  const rows = await db.query<{ key: string; data: T; taken_at: Date | string }>(
    "select key, data, taken_at from snapshots where kind = $1 and taken_at > now() - make_interval(hours => $2) order by taken_at asc",
    [kind, sinceHours],
  );
  return rows.map((r) => ({ key: r.key, data: r.data, takenAt: new Date(r.taken_at).toISOString() }));
}

/** Stores a snapshot as the only one for its key: a "last good result" cache, not history. */
export async function replaceSnapshot(kind: string, key: string, data: unknown) {
  const db = await getDb();
  await db.tx(async (tx) => {
    await tx.query("delete from snapshots where kind = $1 and key = $2", [kind, key]);
    await tx.query("insert into snapshots (kind, key, data) values ($1, $2, $3::text::jsonb)", [kind, key, JSON.stringify(data)]);
  });
}

/** The newest snapshot for each of these keys. */
export async function latestSnapshots<T>(kind: string, keys: string[]): Promise<Map<string, { data: T; takenAt: string }>> {
  if (!keys.length) return new Map();
  const db = await getDb();
  const rows = await db.query<{ key: string; data: T; taken_at: Date | string }>(
    "select distinct on (key) key, data, taken_at from snapshots where kind = $1 and key = any($2::text[]) order by key, taken_at desc, id desc",
    [kind, keys],
  );
  return new Map(rows.map((r) => [r.key, { data: r.data, takenAt: new Date(r.taken_at).toISOString() }]));
}
