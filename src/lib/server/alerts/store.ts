import { canSeeTask, type Access } from "../../access";
import type { Severity } from "../../types";
import { getDb } from "../db";
import { normalizePrefs, type NotifyPrefs } from "./decide";

// Preferences and the delivery log, as the pages, actions and the push action
// route read and change them. Routing itself lives in ./run.

export type AlertStatus = "queued" | "sent" | "failed" | "suppressed" | "folded";
export type LogKind = "alert" | "resolved" | "digest" | "test";

export interface AlertEntry {
  id: string;
  userEmail: string;
  taskId: string | null;
  kind: LogKind;
  severity: Severity;
  title: string;
  body: string | null;
  url: string | null;
  status: AlertStatus;
  reason: string | null;
  deliverAfter: string;
  createdAt: string;
  sentAt: string | null;
  readAt: string | null;
  ackedAt: string | null;
}

interface LogRow {
  id: string;
  user_email: string;
  task_id: string | null;
  kind: LogKind;
  severity: Severity;
  title: string;
  body: string | null;
  url: string | null;
  status: AlertStatus;
  reason: string | null;
  deliver_after: Date | string;
  created_at: Date | string;
  sent_at: Date | string | null;
  read_at: Date | string | null;
  acked_at: Date | string | null;
  // the task, joined, so callers can re-check who may see it
  t_business: string | null;
  t_source_key: string | null;
  t_assignee: string | null;
  t_private_to: string | null;
}

const iso = (v: Date | string | null) => (v == null ? null : new Date(v).toISOString());

const toEntry = (r: LogRow): AlertEntry => ({
  id: r.id,
  userEmail: r.user_email,
  taskId: r.task_id,
  kind: r.kind,
  severity: r.severity,
  title: r.title,
  body: r.body,
  url: r.url,
  status: r.status,
  reason: r.reason,
  deliverAfter: iso(r.deliver_after)!,
  createdAt: iso(r.created_at)!,
  sentAt: iso(r.sent_at),
  readAt: iso(r.read_at),
  ackedAt: iso(r.acked_at),
});

/** Rows about a task the viewer can no longer see (access changed since) are hidden. */
const visibleTo = (viewer: Access, email: string) => (r: LogRow) =>
  !r.task_id || canSeeTask(viewer, email, { business: r.t_business, sourceKey: r.t_source_key, assignee: r.t_assignee, privateTo: r.t_private_to });

const SELECT = `select l.id, l.user_email, l.task_id, l.kind, l.severity, l.title, l.body, l.url, l.status, l.reason, l.deliver_after, l.created_at, l.sent_at, l.read_at, l.acked_at,
  coalesce(t.business_override, t.business) as t_business, t.source_key as t_source_key, t.assignee as t_assignee, t.private_to as t_private_to`;

// ─── Preferences ─────────────────────────────────────────────────────────────

export async function getPrefs(email: string): Promise<NotifyPrefs> {
  const db = await getDb();
  const [row] = await db.query<{ notify_prefs: unknown }>("select notify_prefs from users where email = $1", [email]);
  return normalizePrefs(row?.notify_prefs);
}

/** Everyone's preferences at once (for routing). */
export async function prefsFor(emails: string[]): Promise<Map<string, NotifyPrefs>> {
  const map = new Map<string, NotifyPrefs>();
  if (!emails.length) return map;
  const db = await getDb();
  const rows = await db.query<{ email: string; notify_prefs: unknown }>("select email, notify_prefs from users where email = any($1::text[])", [emails]);
  for (const r of rows) map.set(r.email, normalizePrefs(r.notify_prefs));
  for (const e of emails) if (!map.has(e)) map.set(e, normalizePrefs(null));
  return map;
}

/**
 * Saves preferences. Upserts the users row, so an environment owner without
 * one (ALLOWED_EMAILS / the password owner) keeps their choice too; a row
 * without a role grants nothing.
 */
export async function savePrefs(email: string, prefs: NotifyPrefs) {
  const db = await getDb();
  const clean = normalizePrefs(prefs);
  await db.query(
    `insert into users (email, notify_prefs) values ($1, $2::text::jsonb)
     on conflict (email) do update set notify_prefs = excluded.notify_prefs`,
    [email, JSON.stringify(clean)],
  );
  return clean;
}

// ─── Reading the log ─────────────────────────────────────────────────────────

/**
 * The bell: a person's latest alerts and resolved messages, with the unread
 * count, in one query. The count is taken after the same visibility check as
 * the list (rows about tasks they can no longer see don't count). Summaries
 * (digests) aren't listed: their items are.
 */
export async function bellFor(viewer: Access & { email: string }, limit = 20): Promise<{ unread: number; urgent: number; items: AlertEntry[] }> {
  const db = await getDb();
  const rows = await db.query<LogRow & { rn: number }>(
    `with mine as (
       ${SELECT}, row_number() over (order by l.created_at desc, l.id) as rn
       from alert_log l left join tasks t on t.id = l.task_id
       where l.user_email = $1 and l.kind in ('alert', 'resolved') and l.status in ('sent', 'folded', 'failed', 'queued'))
     select * from mine where rn <= $2 or (read_at is null and status <> 'queued') order by created_at desc, id limit 500`,
    [viewer.email, limit],
  );
  const visible = rows.filter(visibleTo(viewer, viewer.email));
  const unread = visible.filter((r) => !r.read_at && r.status !== "queued");
  return {
    unread: unread.length,
    // The app icon badge: unread critical and high alerts.
    urgent: unread.filter(isUrgent).length,
    items: visible.filter((r) => Number(r.rn) <= limit).map(toEntry),
  };
}

const isUrgent = (r: Pick<LogRow, "kind" | "severity">) => r.kind === "alert" && (r.severity === "critical" || r.severity === "high");

/** Unread critical/high alerts per person (for the app icon badge sent with a push). */
export async function urgentUnread(emails: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!emails.length) return map;
  const db = await getDb();
  const rows = await db.query<{ user_email: string; n: number }>(
    `select user_email, count(*)::int as n from alert_log
     where user_email = any($1::text[]) and kind = 'alert' and severity in ('critical', 'high') and read_at is null and status in ('sent', 'folded', 'failed')
     group by user_email`,
    [emails],
  );
  for (const r of rows) map.set(r.user_email, Number(r.n));
  return map;
}

/**
 * Delivery log: everyone's (full owners) or the viewer's own. Everyone's
 * leaves out other people's rows about their personal items (their own
 * mailbox), and any row about a task the viewer may not see.
 */
export async function deliveryLog(viewer: Access & { email: string }, all: boolean, limit = 100): Promise<AlertEntry[]> {
  const db = await getDb();
  const rows = await db.query<LogRow>(
    `${SELECT} from alert_log l left join tasks t on t.id = l.task_id
     where ($1::text is null or l.user_email = $1)
       and (l.user_email = $3 or (not l.private and t.private_to is null))
     order by l.created_at desc limit $2`,
    [all ? null : viewer.email, limit, viewer.email],
  );
  const own = visibleTo(viewer, viewer.email);
  return (all ? rows.filter((r) => !r.t_private_to || own(r)) : rows.filter(own)).map(toEntry);
}

/** One log row, only if it belongs to this person. */
export async function ownEntry(email: string, id: string): Promise<AlertEntry | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const db = await getDb();
  const [row] = await db.query<LogRow>(`${SELECT} from alert_log l left join tasks t on t.id = l.task_id where l.id = $1 and l.user_email = $2`, [id, email]);
  return row ? toEntry(row) : null;
}

// ─── Changing it ─────────────────────────────────────────────────────────────

export async function markRead(email: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return;
  const db = await getDb();
  await db.query("update alert_log set read_at = coalesce(read_at, now()) where id = $1 and user_email = $2", [id, email]);
}

export async function markAllRead(email: string) {
  const db = await getDb();
  await db.query("update alert_log set read_at = now() where user_email = $1 and read_at is null and status <> 'queued'", [email]);
}

/**
 * Acknowledge: this person's rows for the task are marked read and acked, and
 * whatever is still queued for them about it is dropped. Others are unaffected.
 */
export async function acknowledge(email: string, taskId: string) {
  const db = await getDb();
  await db.query(
    `update alert_log set status = case when status = 'queued' then 'suppressed' else status end,
       reason = case when status = 'queued' then 'acknowledged' else reason end,
       read_at = coalesce(read_at, now()), acked_at = coalesce(acked_at, now()), lease_until = null
     where user_email = $1 and task_id = $2`,
    [email, taskId],
  );
}
