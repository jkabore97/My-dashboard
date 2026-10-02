import { getDb } from "../db";

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const db = await getDb();
  const [row] = await db.query<{ value: T }>("select value from settings where key = $1", [key]);
  return row ? row.value : fallback;
}

export async function setSetting(key: string, value: unknown) {
  const db = await getDb();
  await db.query(
    "insert into settings (key, value) values ($1, $2::text::jsonb) on conflict (key) do update set value = excluded.value, updated_at = now()",
    [key, JSON.stringify(value)],
  );
}

/**
 * Atomically claims a periodic job slot. Returns true for exactly one caller
 * per interval, so page loads and cron don't all run the same sync at once.
 */
export async function claimInterval(key: string, intervalSeconds: number): Promise<boolean> {
  const db = await getDb();
  const rows = await db.query(
    `insert into settings (key, value, updated_at) values ($1, 'null'::jsonb, now())
     on conflict (key) do update set updated_at = now()
       where settings.updated_at < now() - make_interval(secs => $2)
     returning key`,
    [key, intervalSeconds],
  );
  return rows.length > 0;
}

/** Makes the next claimInterval() for this key succeed immediately. */
export async function expireInterval(key: string) {
  const db = await getDb();
  await db.query("update settings set updated_at = 'epoch'::timestamptz where key = $1", [key]);
}

export async function lastRun(key: string): Promise<string | null> {
  const db = await getDb();
  const [row] = await db.query<{ updated_at: Date | string }>("select updated_at from settings where key = $1 and updated_at > 'epoch'::timestamptz", [key]);
  return row ? new Date(row.updated_at).toISOString() : null;
}
