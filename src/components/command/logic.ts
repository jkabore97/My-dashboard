import { addDays, today } from "@/lib/dates";
import { SEVERITY_ORDER, type CalendarEvent, type EmailMessage, type Notification, type Severity, type Website } from "@/lib/types";

// Pure roll-ups for the Command pages (Overview, To-do, Inbox, Agenda, Alerts).
// Nothing here invents data: every number is counted from what the page already has.

const RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/** The most severe of these, or null for none. */
export function worstSeverity(items: { severity: Severity }[]): Severity | null {
  let worst: Severity | null = null;
  for (const i of items) if (worst === null || RANK[i.severity] < RANK[worst]) worst = i.severity;
  return worst;
}

export interface RingSegment {
  business: string;
  open: number;
  critical: number;
  high: number;
  /** Worst open task severity; null when nothing is open. */
  worst: Severity | null;
}

/** One reactor-ring segment per business, colored by its worst open task. */
export function businessRing(businesses: string[], tasks: { business?: string; severity: Severity }[]): RingSegment[] {
  return businesses.map((b) => {
    const mine = tasks.filter((t) => (t.business ?? "Unassigned") === b);
    return {
      business: b,
      open: mine.length,
      critical: mine.filter((t) => t.severity === "critical").length,
      high: mine.filter((t) => t.severity === "high").length,
      worst: worstSeverity(mine),
    };
  });
}

/** Counts per severity, in severity order. */
export function severityCounts(items: { severity: Severity }[]): Record<Severity, number> {
  const out = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const i of items) out[i.severity]++;
  return out;
}

export interface UptimePoint {
  status: Website["status"];
  responseMs: number | null;
  takenAt: string;
}

/** Checks over a window as fixed buckets (worst status per bucket) plus the share of "up" checks. */
export function uptimeBuckets(points: UptimePoint[], now: number, hours = 24, buckets = 48): { ticks: (Website["status"] | null)[]; pct: number | null } {
  const start = now - hours * 3_600_000;
  const rank = { up: 0, unknown: 1, degraded: 2, down: 3 } as const;
  const ticks: (Website["status"] | null)[] = Array(buckets).fill(null);
  const inWindow = points.filter((p) => Date.parse(p.takenAt) >= start);
  for (const p of inWindow) {
    const i = Math.min(buckets - 1, Math.max(0, Math.floor(((Date.parse(p.takenAt) - start) / (now - start)) * buckets)));
    const cur = ticks[i];
    if (!cur || rank[p.status] > rank[cur]) ticks[i] = p.status;
  }
  const pct = inWindow.length ? (inWindow.filter((p) => p.status === "up").length / inWindow.length) * 100 : null;
  return { ticks, pct };
}

export interface MailboxSummary {
  account: string;
  mailbox: string;
  provider: "gmail" | "outlook";
  business?: string;
  total: number;
  unread: number;
}

export function inboxStats(emails: EmailMessage[]) {
  const boxes = new Map<string, MailboxSummary>();
  for (const e of emails) {
    const b = boxes.get(e.account) ?? { account: e.account, mailbox: e.mailbox, provider: e.mailbox.startsWith("ms:") ? "outlook" : "gmail", business: e.business, total: 0, unread: 0 };
    b.total++;
    if (e.unread) b.unread++;
    boxes.set(e.account, b);
  }
  const triaged = emails.filter((e) => e.triage);
  return {
    total: emails.length,
    unread: emails.filter((e) => e.unread).length,
    critical: emails.filter((e) => e.severity === "critical").length,
    criticalUnread: emails.filter((e) => e.unread && e.severity === "critical").length,
    triaged: triaged.length,
    needsReply: triaged.filter((e) => e.triage!.needsReply).length,
    withTask: triaged.filter((e) => !e.triage!.needsReply && e.triage!.task).length,
    fyi: triaged.filter((e) => !e.triage!.needsReply && !e.triage!.task).length,
    mailboxes: [...boxes.values()].sort((a, b) => b.unread - a.unread || a.account.localeCompare(b.account)),
  };
}

/** The platform part of a notification source ("Email · Kaj" → "Email"). */
export const sourceName = (source: string) => source.split(" · ")[0].trim() || source;

export type DayVolume = { day: string } & Record<Severity, number>;

/** Events per day for the last `days` days (oldest first), split by severity. */
export function eventVolume(events: Pick<Notification, "at" | "severity">[], days: number, tz: string, now = new Date()): DayVolume[] {
  const end = today(tz, now);
  const out: DayVolume[] = Array.from({ length: days }, (_, i) => ({ day: addDays(end, i - days + 1), critical: 0, high: 0, medium: 0, low: 0 }));
  const index = new Map(out.map((d, i) => [d.day, i]));
  for (const e of events) {
    const i = index.get(today(tz, new Date(e.at)));
    if (i !== undefined) out[i][e.severity]++;
  }
  return out;
}

/** Events per platform since a time, most first. */
export function sourceCounts(events: Pick<Notification, "at" | "source">[], sinceMs: number): { source: string; count: number }[] {
  const m = new Map<string, number>();
  for (const e of events) if (Date.parse(e.at) >= sinceMs) m.set(sourceName(e.source), (m.get(sourceName(e.source)) ?? 0) + 1);
  return [...m].map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count || a.source.localeCompare(b.source));
}

/** Items grouped by their calendar day in a time zone, newest day first, order kept within a day. */
export function groupByDay<T extends { at: string }>(items: T[], tz: string): [string, T[]][] {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const d = today(tz, new Date(it.at));
    m.set(d, [...(m.get(d) ?? []), it]);
  }
  return [...m].sort(([a], [b]) => b.localeCompare(a));
}

/** Minutes of meetings (timed events only) and how many have a video link. */
export function meetingStats(events: CalendarEvent[]) {
  const timed = events.filter((e) => !e.allDay);
  const minutes = timed.reduce((n, e) => n + Math.max(0, Math.round((Date.parse(e.end) - Date.parse(e.start)) / 60_000)), 0);
  return { events: events.length, minutes, video: events.filter((e) => e.meetingUrl).length };
}

/** "8 h 15 m", "45 m". */
export function formatMinutes(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? (m ? `${h} h ${m} m` : `${h} h`) : `${m} m`;
}

/** The next timed event that hasn't started yet, else the one in progress. */
export function nextEvent(events: CalendarEvent[], now: number): { event: CalendarEvent; inProgress: boolean } | null {
  const timed = events.filter((e) => !e.allDay).sort((a, b) => a.start.localeCompare(b.start));
  const live = timed.find((e) => Date.parse(e.start) <= now && Date.parse(e.end) > now);
  const next = timed.find((e) => Date.parse(e.start) > now);
  if (next) return { event: next, inProgress: false };
  if (live) return { event: live, inProgress: true };
  return null;
}

/** Calendars with their provider and event count, most events first. */
export function calendarSummary(events: CalendarEvent[]) {
  const m = new Map<string, { calendar: string; provider: CalendarEvent["provider"]; count: number }>();
  for (const e of events) {
    const k = `${e.provider}:${e.calendar}`;
    const c = m.get(k) ?? { calendar: e.calendar, provider: e.provider, count: 0 };
    c.count++;
    m.set(k, c);
  }
  return [...m.values()].sort((a, b) => b.count - a.count || a.calendar.localeCompare(b.calendar));
}

/** Largest lines first; the rest folded into a count. */
export function topLines<T extends { amount: number }>(lines: T[], n: number): { top: T[]; rest: number; restAmount: number } {
  const sorted = [...lines].sort((a, b) => b.amount - a.amount);
  const rest = sorted.slice(n);
  return { top: sorted.slice(0, n), rest: rest.length, restAmount: rest.reduce((s, l) => s + l.amount, 0) };
}

export { SEVERITY_ORDER };
