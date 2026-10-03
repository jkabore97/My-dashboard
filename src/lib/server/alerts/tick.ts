import { collect, refetchExternal } from "../../aggregate";
import { errorMessage } from "../../source";
import { randomToken, safeEqual, sha256Hex } from "../crypto";
import { claimInterval, getSetting, lastRun, setSetting } from "../store/settings";
import { claimRefetch, persist } from "../sync";
import { claimBillingRefresh, refreshBilling } from "../billing-refresh";
import { emptySummary, runAlertsSafe, type AlertRunSummary } from "./run";

// The 5-minute scheduler. Vercel Hobby runs crons once a day, so a free
// external scheduler (cron-job.org) calls /api/tick every 5 minutes with
// "Authorization: Bearer <token>" (the token made in Settings; only its
// SHA-256 is stored, like the solar ingest token) or Bearer $CRON_SECRET.
// /api/tick/<token> is the fallback for schedulers that can't send headers
// (a token in the path can end up in access logs).

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

/** Bearer CRON_SECRET, or the scheduler token (as a Bearer header, or in the path). */
export async function authorizeTick(pathToken: string | null, authorization: string | null): Promise<boolean> {
  const secret = process.env.CRON_SECRET?.trim();
  if (secret && authorization && safeEqual(authorization, `Bearer ${secret}`)) return true;
  const bearer = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? null;
  const hash = await getSetting<string | null>(TICK_TOKEN_KEY, null);
  if (!hash) return false;
  return [bearer, pathToken].some((t) => !!t && t.length <= 200 && safeEqual(sha256Hex(t), hash));
}



export const lastTick = () => lastRun("job:tick");

export interface TickResult {
  ok: boolean;
  skipped?: string;
  ms: number;
  synced?: boolean | "timeout";
  alerts?: AlertRunSummary | null;
  /** Billing caches refreshed in this run. */
  bills?: string[];
  error?: string;
}

/** The platform sync gets this long; the alert passes run regardless. */
const SYNC_BUDGET_MS = 35_000;
/** Billing reads start only after alerts, and only while this much of the 60 s function is left. */
const BILLING_END_MS = 55_000;

const add = (a: AlertRunSummary | null, b: AlertRunSummary | null): AlertRunSummary | null => {
  if (!a || !b) return a ?? b;
  const out = emptySummary();
  for (const k of Object.keys(out) as (keyof AlertRunSummary)[]) out[k] = a[k] + b[k];
  return out;
};

/**
 * One pass, well under 60 s: alerts first (queued items and webhook tasks
 * go out even if the platforms are slow), then fresh platform data → tasks
 * within a time budget, then alerts again for what the sync found. A ~4
 * minute lease keeps two schedulers (or a retry) from overlapping. Fail-soft.
 */
export async function runTick(): Promise<TickResult> {
  const started = Date.now();
  if (!(await claimInterval("job:tick", TICK_LEASE_SECONDS))) return { ok: true, skipped: "another run is in progress or ran under 4 minutes ago", ms: Date.now() - started };
  const first = await runAlertsSafe();
  // Billing is refreshed by this run, after alerts (not by the page-style background refresh inside collect()).
  const billing = await claimBillingRefresh();
  let error: string | undefined;
  const sync = (async () => {
    if (await claimRefetch()) refetchExternal();
    const c = await collect();
    return persist(c, { force: true, alerts: false });
  })().catch((err) => {
    // Details go to the server log only; the response is public-facing.
    console.error(`[tick] ${errorMessage(err)}`);
    error = "sync failed (see the server logs)";
    return false;
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const synced = await Promise.race([sync, new Promise<"timeout">((r) => (timer = setTimeout(() => r("timeout"), SYNC_BUDGET_MS)))]);
  clearTimeout(timer);
  const second = synced === true ? await runAlertsSafe() : null;
  // Its own step, with whatever time is left: never eats into the sync budget.
  const bills = billing && synced !== "timeout" ? await refreshBilling({ deadline: started + BILLING_END_MS }).catch((err) => (console.error(`[tick] billing: ${errorMessage(err)}`), [] as string[])) : [];
  return { ok: !error, ms: Date.now() - started, synced, alerts: add(first, second), ...(bills.length ? { bills } : {}), ...(error ? { error } : {}) };
}
