import { getDb } from "../db";

/**
 * Fixed-window counter. Returns false once `limit` attempts happened inside
 * `windowSeconds` for this key.
 */
export async function hitRateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const db = await getDb();
  const [row] = await db.query<{ count: number }>(
    `insert into rate_limits (key, count, window_start) values ($1, 1, now())
     on conflict (key) do update set
       count = case when rate_limits.window_start < now() - make_interval(secs => $2) then 1 else rate_limits.count + 1 end,
       window_start = case when rate_limits.window_start < now() - make_interval(secs => $2) then now() else rate_limits.window_start end
     returning count`,
    [key, windowSeconds],
  );
  return Number(row.count) <= limit;
}

export async function clearRateLimit(key: string) {
  const db = await getDb();
  await db.query("delete from rate_limits where key = $1", [key]);
}
