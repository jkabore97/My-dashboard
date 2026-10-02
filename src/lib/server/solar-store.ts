import { DEFAULT_SOLAR_SETTINGS, type SolarReading, type SolarSettings } from "../solar";
import { env } from "../source";
import { safeEqual, sha256Hex } from "./crypto";
import { getDb } from "./db";
import { getSetting } from "./store/settings";
import { audit } from "./store/audit";
import { takeAttempt } from "./store/ratelimit";

// Solar readings live in snapshots (kind "solar", key = station id). The push
// endpoint authenticates with a bearer token: SOLAR_INGEST_TOKEN, or one
// generated in Settings (only its SHA-256 is stored).

export interface SolarConfig extends SolarSettings {
  /** station id → business name */
  businesses: Record<string, string>;
}

export async function solarConfig(): Promise<SolarConfig> {
  const s = await getSetting<Partial<SolarConfig>>("solar", {});
  return { ...DEFAULT_SOLAR_SETTINGS, businesses: {}, ...s };
}

export async function ingestConfigured(): Promise<boolean> {
  return !!env("SOLAR_INGEST_TOKEN") || !!(await getSetting<string | null>("solar_ingest_token_hash", null));
}

export async function checkIngestToken(header: string | null): Promise<boolean> {
  const token = header?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) return false;
  const fromEnv = env("SOLAR_INGEST_TOKEN");
  if (fromEnv && safeEqual(token, fromEnv)) return true;
  const hash = await getSetting<string | null>("solar_ingest_token_hash", null);
  return !!hash && safeEqual(sha256Hex(token), hash);
}

/**
 * Stores a reading unless the same station sent one with the same status and
 * alarms less than 20 s before or after it (retries, two bridges). A change of
 * state (a fault) is always stored. Returns whether it was stored.
 */
/**
 * Ingest auth. A valid token is always accepted: the bridge must never be
 * locked out by someone else's failures. Failed tokens are counted per IP
 * when the IP can be trusted (20 per 15 minutes, then 429). When it can't,
 * there's no limit at all: a shared bucket would let anyone block the bridge,
 * and the token (24 random bytes, or your own long secret) can't be guessed.
 */
export async function authorizeIngest(header: string | null, ip: string | null): Promise<"ok" | "invalid" | "limited"> {
  if (await checkIngestToken(header)) return "ok";
  if (!ip) return "invalid";
  const key = `ingest:solar:${ip}`;
  const n = await takeAttempt(key, 15 * 60);
  if (n === 21) await audit("solar-ingest", "ingest.rate_limited", key, null, ip);
  return n > 20 ? "limited" : "invalid";
}

export async function storeReading(r: SolarReading): Promise<boolean> {
  const db = await getDb();
  const rows = await db.query(
    `insert into snapshots (kind, key, data, taken_at)
     select 'solar', $1, $2::text::jsonb, $3::timestamptz
     where not exists (
       select 1 from snapshots where kind = 'solar' and key = $1
         and taken_at > $3::timestamptz - interval '20 seconds' and taken_at < $3::timestamptz + interval '20 seconds'
         and data->>'status' = $4 and data->'alarms' = $5::text::jsonb)
     returning id`,
    [r.station, JSON.stringify(r), r.at, r.status, JSON.stringify(r.alarms)],
  );
  return rows.length > 0;
}

/**
 * Readings for the Solar page and rules: everything from the last 36 hours,
 * plus each station's best reading per day for the 14 days before (for the
 * daily-energy chart without loading every 5-minute row), plus each station's
 * newest reading however old, so a long-silent station keeps existing (and
 * keeps its "stopped reporting" task) until its history is pruned.
 */
export async function loadReadings(): Promise<SolarReading[]> {
  const db = await getDb();
  const newest = await db.query<{ data: SolarReading }>("select distinct on (key) data from snapshots where kind = 'solar' order by key, taken_at desc, id desc");
  const recent = await db.query<{ data: SolarReading }>(
    "select data from snapshots where kind = 'solar' and taken_at > now() - interval '36 hours' order by taken_at asc",
  );
  const older = await db.query<{ data: SolarReading }>(
    `select distinct on (key, taken_at::date) data from snapshots
     where kind = 'solar' and taken_at <= now() - interval '36 hours' and taken_at > now() - interval '15 days'
     order by key, taken_at::date, (data->>'todayKWh')::float8 desc nulls last`,
  );
  const unique = new Map<string, SolarReading>(); // the newest row is usually also a recent one
  for (const { data } of [...older, ...recent, ...newest]) unique.set(`${data.station}|${data.at}`, data);
  return [...unique.values()];
}
