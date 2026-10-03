import { createHash } from "node:crypto";
import { decryptJson, encryptJson } from "./crypto";
import { getDb } from "./db";
import { getSetting, setSetting } from "./store/settings";

// Billing data changes a few times a day at most, and some of it costs money
// or rate limit to read (BigQuery scans, Azure billing). It is kept apart
// from the minute-by-minute platform snapshot: encrypted in settings, with
// its own age limit, and refetched only when that runs out or the inputs
// (connection, export table) change.

const PREFIX = "cache:slow:";

interface Entry {
  sig: string;
  at: number;
  ttl: number;
  data: string;
}

/**
 * Returns the cached value for `key` when it's younger than its TTL and was
 * made from the same inputs (`inputs` is hashed, never stored); otherwise
 * runs `fetcher`, stores the result and returns it. `ttl` may depend on the
 * value (shorter for an error message, so a fixed permission shows sooner).
 */
export async function slowCached<T>(key: string, inputs: unknown, fetcher: () => Promise<T>, ttl: (value: T) => number): Promise<T> {
  const sig = createHash("sha256").update(JSON.stringify(inputs ?? null)).digest("hex");
  try {
    const hit = await getSetting<Entry | null>(PREFIX + key, null);
    if (hit && hit.sig === sig && Date.now() - hit.at < hit.ttl) return decryptJson<T>(hit.data);
  } catch {
    /* unreadable or no database: fetch */
  }
  const value = await fetcher();
  await setSetting(PREFIX + key, { sig, at: Date.now(), ttl: ttl(value), data: encryptJson(value) } satisfies Entry).catch(() => {});
  return value;
}

/** Drops every slow cache (after connecting or disconnecting a platform). */
export async function clearSlowCaches() {
  const db = await getDb();
  await db.query("delete from settings where left(key, length($1)) = $1", [PREFIX]);
}

export const HOUR = 3_600_000;
