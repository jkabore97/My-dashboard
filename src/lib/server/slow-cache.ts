import { createHash } from "node:crypto";
import { decryptJson, encryptJson } from "./crypto";
import { getDb } from "./db";
import { getSetting, setSetting } from "./store/settings";

// Billing data changes a few times a day at most, and reading it is slow or
// costs money (BigQuery scans, Azure invoice paging, mailbox searches). It is
// kept apart from the minute-by-minute platform snapshot: encrypted in
// settings, each entry with its own age limit and a hash of the inputs it was
// made from (connection, key id, export table, business rules…).
//
// Pages only ever READ these entries (readSlow). Refreshing happens in the
// background or in the scheduled run's own step (server/billing-refresh.ts),
// so a slow billing API never holds up a page or the tick's sync.

const PREFIX = "cache:slow:";

interface Entry {
  sig: string;
  at: number;
  ttl: number;
  data: string;
}

export const inputSig = (inputs: unknown) => createHash("sha256").update(JSON.stringify(inputs ?? null)).digest("hex");

export interface SlowRead<T> {
  /** The cached value made from these inputs; null when there is none yet. */
  value: T | null;
  /** True when missing, past its age limit, or made from other inputs. */
  stale: boolean;
  at: number | null;
}

/** Reads the cached value for `key` if it was made from the same inputs (any age). Never fetches. */
export async function readSlow<T>(key: string, inputs: unknown): Promise<SlowRead<T>> {
  try {
    const hit = await getSetting<Entry | null>(PREFIX + key, null);
    if (!hit || hit.sig !== inputSig(inputs)) return { value: null, stale: true, at: null };
    return { value: decryptJson<T>(hit.data), stale: Date.now() - hit.at >= hit.ttl, at: hit.at };
  } catch {
    return { value: null, stale: true, at: null };
  }
}

/** Runs `fetcher` and stores its result. `ttl` may depend on the value (shorter for an error, so a fixed permission shows sooner). */
export async function writeSlow<T>(key: string, inputs: unknown, fetcher: () => Promise<T>, ttl: (value: T) => number): Promise<T> {
  const value = await fetcher();
  await setSetting(PREFIX + key, { sig: inputSig(inputs), at: Date.now(), ttl: ttl(value), data: encryptJson(value) } satisfies Entry).catch(() => {});
  return value;
}

/** The cached value when fresh, otherwise fetches and stores it (blocking: for background jobs and tests). */
export async function slowCached<T>(key: string, inputs: unknown, fetcher: () => Promise<T>, ttl: (value: T) => number): Promise<T> {
  const hit = await readSlow<T>(key, inputs);
  if (hit.value !== null && !hit.stale) return hit.value;
  return writeSlow(key, inputs, fetcher, ttl);
}

/** Drops the named caches (only those whose inputs a change affects). */
export async function clearSlowCaches(keys: string[]) {
  if (!keys.length) return;
  const db = await getDb();
  await db.query("delete from settings where key = any($1::text[])", [keys.map((k) => PREFIX + k)]);
}

export const HOUR = 3_600_000;
