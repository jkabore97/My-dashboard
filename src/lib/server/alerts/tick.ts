import { collect, refetchExternal } from "../../aggregate";
import { errorMessage } from "../../source";
import { randomToken, safeEqual, sha256Hex } from "../crypto";
import { claimInterval, getSetting, lastRun, setSetting } from "../store/settings";
import { persist } from "../sync";
import { runAlertsSafe, type AlertRunSummary } from "./run";

// The 5-minute scheduler. Vercel Hobby runs crons once a day, so a free
// external scheduler (cron-job.org) calls /api/tick/<token> every 5 minutes.
// The token is made in Settings and only its SHA-256 is stored, like the
// solar ingest token. Authorization: Bearer $CRON_SECRET works too.

export const TICK_TOKEN_KEY = "tick_token_hash";
const TICK_LEASE_SECONDS = 240;

export async function tickConfigured(): Promise<boolean> {
  return !!(await getSetting<string | null>(TICK_TOKEN_KEY, null));
}

/** Makes a new token (the old one stops working). Returns it once; only the hash is kept. */
export async function createTickToken(): Promise<string> {
  const token = `tick_${randomToken(24)}`;
  await setSetting(TICK_TOKEN_KEY, sha256Hex(token));
  return token;
}

/** A path token matching the stored hash, or the CRON_SECRET bearer header. */
export async function authorizeTick(pathToken: string | null, authorization: string | null): Promise<boolean> {
  const secret = process.env.CRON_SECRET?.trim();
  if (secret && authorization && safeEqual(authorization, `Bearer ${secret}`)) return true;
  if (!pathToken || pathToken.length > 200) return false;
  const hash = await getSetting<string | null>(TICK_TOKEN_KEY, null);
  return !!hash && safeEqual(sha256Hex(pathToken), hash);
}

export const lastTick = () => lastRun("job:tick");

export interface TickResult {
  ok: boolean;
  skipped?: string;
  ms: number;
  synced?: boolean;
  alerts?: AlertRunSummary | null;
  error?: string;
}

/**
 * One pass: fresh platform data → tasks → alerts. A ~4 minute lease keeps two
 * schedulers (or a retry) from overlapping. Each stage fails soft; alerts run
 * even when the platform fetch failed, so queued items still go out.
 */
export async function runTick(): Promise<TickResult> {
  const started = Date.now();
  if (!(await claimInterval("job:tick", TICK_LEASE_SECONDS))) return { ok: true, skipped: "another run is in progress or ran under 4 minutes ago", ms: Date.now() - started };
  let synced = false;
  let error: string | undefined;
  try {
    refetchExternal();
    const c = await collect();
    synced = await persist(c, { force: true, alerts: false });
  } catch (err) {
    // Details go to the server log only; the response is public-facing.
    console.error(`[tick] ${errorMessage(err)}`);
    error = "sync failed (see the server logs)";
  }
  const alerts = await runAlertsSafe();
  return { ok: !error, ms: Date.now() - started, synced, alerts, ...(error ? { error } : {}) };
}
