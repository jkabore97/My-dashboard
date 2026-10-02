// Calendar dates ("YYYY-MM-DD") for deadlines, invoices and renewals. "Today"
// is evaluated in BUSINESS_TIMEZONE (default UTC) so a deadline doesn't flip
// to overdue at the wrong midnight.
const DAY = 86_400_000;

export const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);

export const businessTimeZone = () => process.env.BUSINESS_TIMEZONE?.trim() || "UTC";

/** The calendar date of a moment in a time zone (today() for a given instant). */
export function today(timeZone = businessTimeZone(), now = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);

/** `anchorDay` (1–31) replaces the date's own day, so repeated steps keep the original month-end day. */
export function addMonths(date: string, months: number, anchorDay?: number | null): string {
  const [y, m, day] = date.split("-").map(Number);
  const d = anchorDay ?? day;
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  // Clamp to the month's last day (Jan 31 + 1 month = Feb 28/29).
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

export const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

export type Recurrence = "none" | "monthly" | "quarterly" | "yearly";
const STEP: Record<Exclude<Recurrence, "none">, number> = { monthly: 1, quarterly: 3, yearly: 12 };

/**
 * The next occurrence after `date`, or null for one-off items. `anchorDay` is
 * the day of month the series started on: a quarterly Mar 31 goes Jun 30,
 * Sep 30, Dec 31 rather than drifting to the 30th. Without it, `date`'s day.
 */
export const nextOccurrence = (date: string, r: Recurrence, anchorDay?: number | null) => (r === "none" ? null : addMonths(date, STEP[r], anchorDay));

/**
 * Rolls a renewal date forward by whole billing periods until it is today or
 * later, anchored on the original date so month-end clamping doesn't drift
 * (Jan 31 → Feb 28 → Mar 31, not Mar 28).
 */
export function rollForward(date: string, interval: "month" | "year", onOrAfter: string): string {
  const step = interval === "month" ? 1 : 12;
  let n = 0;
  let cur = date;
  while (cur < onOrAfter && n < 1200) cur = addMonths(date, step * ++n);
  return cur;
}

export function formatDate(date: string) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
}

/** "in 3 days", "today", "5 days ago". */
export function relativeDays(days: number) {
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}
