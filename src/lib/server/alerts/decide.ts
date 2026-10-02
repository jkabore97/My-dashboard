// Pure alert routing rules: given a message's severity and kind, a person's
// preferences and the time, decide whether to push now, queue it until a
// later moment, or skip it. No I/O, so it is unit-tested directly.
//
//  - critical: now, always (even paused or in quiet hours)
//  - high:     now; during quiet hours or a pause, queued until they end
//  - medium:   queued into one digest at the next 12:00 in the person's zone
//  - low:      never pushed (the morning brief covers it)
//  - resolved: only critical/high, only when on; skipped (not queued) in quiet hours or a pause

import type { Severity } from "../../types";

export interface NotifyPrefs {
  /** IANA zone; null = BUSINESS_TIMEZONE. */
  timeZone: string | null;
  /** Quiet hours, whole local hours (from == to means no quiet hours). */
  quietFrom: number;
  quietTo: number;
  /** Push high alerts at once (off: they join the noon digest). */
  high: boolean;
  /** Noon digest of medium items. */
  digest: boolean;
  /** "Resolved" messages for critical/high alerts. */
  resolved: boolean;
  /** Non-critical pushes wait until this moment (ISO), if set. */
  pausedUntil: string | null;
}

export const DEFAULT_PREFS: NotifyPrefs = { timeZone: null, quietFrom: 22, quietTo: 7, high: true, digest: true, resolved: true, pausedUntil: null };

export const DIGEST_HOUR = 12;
/** The reason a queued row carries when it waits for the noon digest. */
export const DIGEST_REASON = "noon digest";
/** Website incidents are pushed only if still open this long after first seen (a second check). */
export const WEBSITE_CONFIRM_MS = 4 * 60_000;
/** More than this many pushes per person in RATE_WINDOW_MS are folded into one summary. */
export const RATE_LIMIT = 5;
export const RATE_WINDOW_MS = 10 * 60_000;

export const validZone = (tz: unknown): tz is string => {
  if (typeof tz !== "string" || !tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

const hour = (v: unknown, fallback: number) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 23 ? (v as number) : fallback);
const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);

/** Anything stored (or posted) → valid preferences; unknown or bad fields fall back to defaults. */
export function normalizePrefs(raw: unknown): NotifyPrefs {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const paused = typeof r.pausedUntil === "string" && !Number.isNaN(Date.parse(r.pausedUntil)) ? new Date(r.pausedUntil).toISOString() : null;
  return {
    timeZone: validZone(r.timeZone) ? r.timeZone : null,
    quietFrom: hour(r.quietFrom, DEFAULT_PREFS.quietFrom),
    quietTo: hour(r.quietTo, DEFAULT_PREFS.quietTo),
    high: bool(r.high, true),
    digest: bool(r.digest, true),
    resolved: bool(r.resolved, true),
    pausedUntil: paused,
  };
}

// ─── Time zone arithmetic ────────────────────────────────────────────────────

interface Local {
  y: number;
  m: number; // 1-12
  d: number;
  h: number;
  min: number;
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" });
    fmtCache.set(tz, f);
  }
  return f;
}

/** Wall-clock parts of an instant in a zone. */
export function localParts(at: Date, tz: string): Local {
  const p = Object.fromEntries(fmt(tz).formatToParts(at).map((x) => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), h: Number(p.hour) % 24, min: Number(p.minute) };
}

/** Minutes the zone is ahead of UTC at this instant. */
function offsetMinutes(at: Date, tz: string) {
  const l = localParts(at, tz);
  const sec = at.getUTCSeconds();
  return Math.round((Date.UTC(l.y, l.m - 1, l.d, l.h, l.min, sec) - (at.getTime() - at.getUTCMilliseconds())) / 60_000);
}

/** The instant a wall-clock time happens in a zone (day overflow is fine: d + 1). */
export function zonedTime(y: number, m: number, d: number, h: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d, h, 0, 0);
  const off1 = offsetMinutes(new Date(guess), tz);
  let t = guess - off1 * 60_000;
  const off2 = offsetMinutes(new Date(t), tz);
  if (off2 !== off1) t = guess - off2 * 60_000;
  return new Date(t);
}

/** The first moment strictly after `now` when the local clock shows `h`:00. */
export function nextLocalHour(now: Date, h: number, tz: string): Date {
  const l = localParts(now, tz);
  const today = zonedTime(l.y, l.m, l.d, h, tz);
  return today.getTime() > now.getTime() ? today : zonedTime(l.y, l.m, l.d + 1, h, tz);
}

export function inQuietHours(now: Date, p: Pick<NotifyPrefs, "quietFrom" | "quietTo">, tz: string): boolean {
  const { quietFrom: from, quietTo: to } = p;
  if (from === to) return false;
  const h = localParts(now, tz).h;
  return from < to ? h >= from && h < to : h >= from || h < to;
}

export const isPaused = (now: Date, p: Pick<NotifyPrefs, "pausedUntil">) => !!p.pausedUntil && Date.parse(p.pausedUntil) > now.getTime();

/** The earliest moment at or after `t` that is neither in quiet hours nor paused. */
export function nextAllowed(t: Date, p: NotifyPrefs, tz: string): Date {
  let at = t;
  for (let i = 0; i < 4; i++) {
    if (isPaused(at, p)) at = new Date(Date.parse(p.pausedUntil!));
    else if (inQuietHours(at, p, tz)) at = nextLocalHour(at, p.quietTo, tz);
    else return at;
  }
  return at;
}

// ─── The decision ────────────────────────────────────────────────────────────

export type AlertKind = "alert" | "resolved";

export type Decision =
  | { action: "now" }
  | { action: "queue"; until: Date; digest: boolean; reason: string }
  | { action: "skip"; reason: string };

export function decide(input: { severity: Severity; kind: AlertKind; prefs: NotifyPrefs; now: Date; fallbackZone?: string }): Decision {
  const { severity, kind, prefs, now } = input;
  const tz = prefs.timeZone ?? (validZone(input.fallbackZone) ? input.fallbackZone : "UTC");

  if (kind === "resolved") {
    if (severity !== "critical" && severity !== "high") return { action: "skip", reason: "resolved messages are for critical and high only" };
    if (!prefs.resolved) return { action: "skip", reason: "resolved messages are off" };
    if (isPaused(now, prefs)) return { action: "skip", reason: "paused" };
    if (inQuietHours(now, prefs, tz)) return { action: "skip", reason: "quiet hours" };
    return { action: "now" };
  }

  if (severity === "critical") return { action: "now" };
  if (severity === "low") return { action: "skip", reason: "low: covered by the morning brief" };

  if (severity === "high" && prefs.high) {
    const at = nextAllowed(now, prefs, tz);
    if (at.getTime() <= now.getTime()) return { action: "now" };
    return { action: "queue", until: at, digest: false, reason: isPaused(now, prefs) ? "paused" : "quiet hours" };
  }

  // Medium, and high with instant high alerts turned off: the noon digest.
  if (!prefs.digest) return { action: "skip", reason: severity === "high" ? "high alerts and the digest are off" : "noon digest is off" };
  const noon = nextLocalHour(now, DIGEST_HOUR, tz);
  return { action: "queue", until: nextAllowed(noon, prefs, tz), digest: true, reason: DIGEST_REASON };
}

/** When a newly seen incident may be routed: website problems wait for a second check. */
export function routeAfter(sourceKey: string | null, firstSeen: Date): Date {
  return sourceKey?.startsWith("websites/") ? new Date(firstSeen.getTime() + WEBSITE_CONFIRM_MS) : firstSeen;
}

/** Per-person rate limit: how many due items go out one by one; the rest fold into one summary. */
export function splitForRateLimit<T>(due: T[], sentRecently: number): { individual: T[]; folded: T[] } {
  const allowed = Math.max(0, RATE_LIMIT - sentRecently);
  if (due.length <= allowed) return { individual: due, folded: [] };
  const n = Math.max(0, allowed - 1);
  return { individual: due.slice(0, n), folded: due.slice(n) };
}
