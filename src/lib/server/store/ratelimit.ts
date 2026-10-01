import { getDb } from "../db";

/**
 * Fixed-window counter: atomically counts one attempt for `key` and returns
 * the count inside the current window. Taking the attempt before acting (and
 * refunding it on success) means parallel requests can't overshoot a limit.
 */
export async function takeAttempt(key: string, windowSeconds: number): Promise<number> {
  const db = await getDb();
  const [row] = await db.query<{ count: number }>(
    `insert into rate_limits (key, count, window_start) values ($1, 1, now())
     on conflict (key) do update set
       count = case when rate_limits.window_start < now() - make_interval(secs => $2) then 1 else rate_limits.count + 1 end,
       window_start = case when rate_limits.window_start < now() - make_interval(secs => $2) then now() else rate_limits.window_start end
     returning count`,
    [key, windowSeconds],
  );
  return Number(row.count);
}

/** Gives back an attempt that succeeded, so only failures count. */
export async function refundAttempt(key: string) {
  const db = await getDb();
  await db.query("update rate_limits set count = greatest(count - 1, 0) where key = $1", [key]);
}

export async function clearRateLimit(key: string) {
  const db = await getDb();
  await db.query("delete from rate_limits where key = $1", [key]);
}
