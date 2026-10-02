import { canSeeTask } from "../../access";
import { businessTimeZone } from "../../dates";
import { errorMessage } from "../../source";
import type { Severity } from "../../types";
import { getDb, type Db } from "../db";
import { pushEnabled, pushText, pushTo, type PushPayload } from "../notify";
import { people, type Person } from "../people";
import { decide, splitForRateLimit, DIGEST_REASON, FRESH_MS, RATE_WINDOW_MS, WEBSITE_CONFIRM_MS } from "./decide";
import { prefsFor, urgentUnread } from "./store";

// Alert routing. Tasks are the incidents: each task has one row in
// alert_incidents tracking its current open period.
//
//   1. open tasks without an incident → incident. New ones (appeared or
//      changed status within the last hour) are routed; older ones get their
//      current severity as a baseline, so only an escalation alerts.
//   2. closed incidents whose task is open again → next period
//   3. open incidents whose task is done → closed; "Resolved" to those alerted
//   4. incidents due for routing (website ones after a second check) → one
//      delivery-log row per person who can see the task, then the incident is
//      marked routed (in one transaction per task, rows first: a crash in
//      between just routes it again, and the dedupe keys make that a no-op)
//   5. due log rows → re-checked (task still open, person still allowed) and
//      pushed, folding non-critical ones over the rate limit into one summary
//
// Claims are conditional UPDATE/INSERT … returning, and log rows are unique
// per (person, message), so overlapping runs never send the same thing twice.
// Writes are batched (one statement per step, not per row). Fail-soft.

const RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const SEV_SQL = "array['critical','high','medium','low']";
const LEASE_SQL = "interval '2 minutes'";
const FLUSH_BATCH = 300;
const ROUTE_BATCH = 200;

export interface AlertRunSummary {
  opened: number;
  reopened: number;
  closed: number;
  routed: number;
  sent: number;
  failed: number;
  suppressed: number;
  folded: number;
}

export const emptySummary = (): AlertRunSummary => ({ opened: 0, reopened: 0, closed: 0, routed: 0, sent: 0, failed: 0, suppressed: 0, folded: 0 });

interface TaskInfo {
  id: string;
  title: string;
  detail: string | null;
  source_key: string | null;
  origin: string;
  severity: Severity;
  status: string;
  business: string | null;
  assignee: string | null;
  /** Personal task: only this person is ever alerted. */
  private_to: string | null;
}

interface QueuedRow {
  id: string;
  user_email: string;
  task_id: string | null;
  period: number | null;
  kind: "alert" | "resolved" | "digest" | "test";
  severity: Severity;
  title: string;
  body: string | null;
  url: string | null;
  reason: string | null;
  private?: boolean;
}

type Final = "sent" | "failed" | "suppressed" | "folded";

const ts = (d: Date) => d.toISOString();
const sees = (p: Person, t: Pick<TaskInfo, "business" | "source_key" | "assignee" | "private_to">) => canSeeTask(p, p.email, { business: t.business, sourceKey: t.source_key, assignee: t.assignee, privateTo: t.private_to });
const TASK_COLS = "t.title, t.detail, t.source_key, t.origin, t.severity, t.status, coalesce(t.business_override, t.business) as business, t.assignee, t.private_to";

export function resolvedText(t: Pick<TaskInfo, "title" | "detail" | "source_key" | "origin">, severity: Severity) {
  const p = pushText(t, severity);
  const email = p.title.endsWith(" email");
  return email ? { title: `Resolved: ${p.title}`, body: p.body } : { title: `Resolved: ${t.title}`.slice(0, 120), body: "Cleared. No action needed any more." };
}

/** Runs every step once. Safe to call from anywhere, any number of times at once. */
export async function runAlerts(opts: { now?: Date } = {}): Promise<AlertRunSummary> {
  const now = opts.now ?? new Date();
  const db = await getDb();
  const sum = emptySummary();
  let everyone: Person[] | null = null;
  const team = async () => (everyone ??= await people());
  const zone = businessTimeZone();

  // Snoozes that ran out count as open again (the To-do page does the same).
  await db.query("update tasks set status = 'open', snoozed_until = null, updated_at = now() where status = 'snoozed' and snoozed_until <= $1::timestamptz", [ts(now)]);

  const routeAfter = `case when t.source_key like 'websites/%' then $1::timestamptz + make_interval(secs => $2) else $1::timestamptz end`;
  const fresh = `greatest(t.created_at, t.occurred_at, t.status_changed_at) > $1::timestamptz - make_interval(secs => $3)`;
  sum.opened = (
    await db.query(
      `insert into alert_incidents (task_id, opened_at, route_after, routed_severity)
       select t.id, $1::timestamptz, case when ${fresh} then ${routeAfter} else $1::timestamptz end, case when ${fresh} then null else t.severity end
       from tasks t where t.status = 'open' and not exists (select 1 from alert_incidents i where i.task_id = t.id)
       on conflict (task_id) do nothing returning task_id`,
      [ts(now), WEBSITE_CONFIRM_MS / 1000, FRESH_MS / 1000],
    )
  ).length;

  sum.reopened = (
    await db.query(
      `update alert_incidents i set period = i.period + 1, state = 'open', opened_at = $1::timestamptz, closed_at = null,
         routed_severity = null, route_after = ${routeAfter}, updated_at = now()
       from tasks t where t.id = i.task_id and i.state = 'closed' and t.status = 'open' returning i.task_id`,
      [ts(now), WEBSITE_CONFIRM_MS / 1000],
    )
  ).length;

  // ── Closed: drop what still waits, tell those who were alerted ────────────
  const closed = await db.query<TaskInfo & { period: number; routed_severity: Severity | null }>(
    `update alert_incidents i set state = 'closed', closed_at = $1::timestamptz, updated_at = now()
     from tasks t where t.id = i.task_id and i.state = 'open' and t.status = 'done'
     returning i.task_id as id, i.period, i.routed_severity, ${TASK_COLS}`,
    [ts(now)],
  );
  sum.closed = closed.length;
  if (closed.length) {
    const ids = closed.map((c) => c.id);
    const periods = closed.map((c) => c.period);
    await db.query(
      `update alert_log l set status = 'suppressed', reason = 'resolved before delivery', lease_until = null
       from unnest($1::uuid[], $2::int[]) as c(task_id, period)
       where l.task_id = c.task_id and l.period = c.period and l.kind = 'alert' and l.status = 'queued'`,
      [ids, periods],
    );
    const loud = closed.filter((c) => c.routed_severity === "critical" || c.routed_severity === "high");
    if (loud.length) {
      // Only the people who actually got the alert hear that it's over.
      const got = await db.query<{ task_id: string; user_email: string }>(
        `select distinct l.task_id, l.user_email from alert_log l join unnest($1::uuid[], $2::int[]) as c(task_id, period)
           on l.task_id = c.task_id and l.period = c.period
         where l.kind = 'alert' and l.status in ('sent', 'folded')`,
        [loud.map((c) => c.id), loud.map((c) => c.period)],
      );
      const prefs = await prefsFor([...new Set(got.map((g) => g.user_email))]);
      const byId = new Map(loud.map((c) => [c.id, c]));
      const rows: NewLog[] = got.map(({ task_id, user_email }) => {
        const inc = byId.get(task_id)!;
        const sev = inc.routed_severity!;
        const d = decide({ severity: sev, kind: "resolved", prefs: prefs.get(user_email)!, now, fallbackZone: zone });
        return {
          user: user_email, taskId: inc.id, period: inc.period, kind: "resolved", severity: sev, ...resolvedText(inc, sev), url: "/tasks",
          status: d.action === "now" ? "queued" : "suppressed", reason: d.action === "skip" ? d.reason : null, deliverAfter: now, dedupe: `resolved:${inc.id}:${inc.period}`,
          private: !!inc.private_to,
        };
      });
      await insertLogs(db, rows);
    }
  }

  // ── Route: rows first, then mark routed, per task ─────────────────────────
  const due = await db.query<TaskInfo & { period: number; routed_severity: Severity | null }>(
    `select i.task_id as id, i.period, i.routed_severity, ${TASK_COLS}
     from alert_incidents i join tasks t on t.id = i.task_id
     where i.state = 'open' and t.status = 'open' and i.route_after <= $1::timestamptz
       and (i.routed_severity is null or array_position(${SEV_SQL}, t.severity) < array_position(${SEV_SQL}, i.routed_severity))
     order by i.route_after limit ${ROUTE_BATCH}`,
    [ts(now)],
  );
  if (due.length) {
    const members = await team();
    const recipients = new Map(due.map((t) => [t.id, t.severity === "low" ? [] : members.filter((p) => sees(p, t))]));
    const prefs = await prefsFor([...new Set([...recipients.values()].flat().map((p) => p.email))]);
    for (const t of due) {
      try {
        const rows: NewLog[] = recipients.get(t.id)!.map((p) => {
          const d = decide({ severity: t.severity, kind: "alert", prefs: prefs.get(p.email)!, now, fallbackZone: zone });
          return {
            user: p.email, taskId: t.id, period: t.period, kind: "alert", severity: t.severity, ...pushText(t, t.severity), url: "/tasks",
            status: d.action === "skip" ? "suppressed" : "queued",
            reason: d.action === "now" ? null : d.reason,
            deliverAfter: d.action === "queue" ? d.until : now,
            dedupe: `alert:${t.id}:${t.period}:${t.severity}`,
            private: !!t.private_to,
          };
        });
        const marked = await db.tx(async (tx) => {
          // An escalation replaces what was still waiting at a lower severity.
          if (t.routed_severity) {
            await tx.query(
              "update alert_log set status = 'suppressed', reason = 'escalated', lease_until = null where task_id = $1 and period = $2 and kind = 'alert' and status = 'queued' and severity <> $3",
              [t.id, t.period, t.severity],
            );
          }
          await insertLogs(tx, rows);
          return tx.query(
            "update alert_incidents set routed_severity = $3, updated_at = now() where task_id = $1 and period = $2 and routed_severity is not distinct from $4 returning task_id",
            [t.id, t.period, t.severity, t.routed_severity],
          );
        });
        if (marked.length) sum.routed++;
      } catch (err) {
        console.error(`[alerts] routing ${t.id}: ${errorMessage(err)}`); // retried on the next run
      }
    }
  }

  const flushed = await flush(db, now, team);
  sum.sent = flushed.sent;
  sum.failed = flushed.failed;
  sum.suppressed = flushed.suppressed;
  sum.folded = flushed.folded;
  return sum;
}

/** runAlerts that never throws (for callers that must not break). */
export async function runAlertsSafe(opts: { now?: Date } = {}): Promise<AlertRunSummary | null> {
  try {
    return await runAlerts(opts);
  } catch (err) {
    console.error(`[alerts] ${errorMessage(err)}`);
    return null;
  }
}

/**
 * A snoozed task starts a new alert period, so it alerts again (once) if it's
 * still open when the snooze ends.
 */
export async function restartIncident(taskId: string, until: Date) {
  const db = await getDb();
  await db.query(
    `update alert_incidents set period = period + 1, routed_severity = null, opened_at = $2::timestamptz, route_after = $2::timestamptz, updated_at = now()
     where task_id = $1 and state = 'open'`,
    [taskId, ts(until)],
  );
}

// ─── Log writes (batched) ────────────────────────────────────────────────────

interface NewLog {
  user: string;
  taskId: string | null;
  period: number | null;
  kind: QueuedRow["kind"];
  severity: Severity;
  title: string;
  body: string | null;
  url: string;
  status: "queued" | "suppressed";
  reason: string | null;
  deliverAfter: Date;
  dedupe: string;
  lease?: Date;
  /** About a personal item: hidden from the owner's view of everyone's log. */
  private?: boolean;
}

/** One multi-row insert; rows that already exist (same person + message) are skipped. */
async function insertLogs(db: Db, rows: NewLog[]): Promise<{ id: string; dedupe_key: string; user_email: string }[]> {
  if (!rows.length) return [];
  const data = rows.map((l) => ({
    user_email: l.user, task_id: l.taskId, period: l.period, kind: l.kind, severity: l.severity, title: l.title.slice(0, 200), body: l.body?.slice(0, 300) ?? null,
    url: l.url, status: l.status, reason: l.reason, deliver_after: ts(l.deliverAfter), dedupe_key: l.dedupe, lease_until: l.lease ? ts(l.lease) : null, private: !!l.private,
  }));
  return db.query(
    `insert into alert_log (user_email, task_id, period, kind, severity, title, body, url, status, reason, deliver_after, dedupe_key, lease_until, private)
     select x.user_email, x.task_id, x.period, x.kind, x.severity, x.title, x.body, x.url, x.status, x.reason, x.deliver_after, x.dedupe_key, x.lease_until, coalesce(x.private, false)
     from jsonb_to_recordset($1::text::jsonb) as x(user_email text, task_id uuid, period int, kind text, severity text, title text, body text, url text,
       status text, reason text, deliver_after timestamptz, dedupe_key text, lease_until timestamptz, private boolean)
     on conflict (user_email, dedupe_key) do nothing returning id, dedupe_key, user_email`,
    [JSON.stringify(data)],
  );
}

/** Settles queued rows in one statement (rows someone else already settled are left alone). */
async function settle(db: Db, rows: { id: string; status: Final; reason: string | null }[], now: Date) {
  if (!rows.length) return;
  await db.query(
    `update alert_log l set status = x.status, reason = coalesce(x.reason, l.reason), lease_until = null,
       sent_at = case when x.status in ('sent', 'folded') then $2::timestamptz else l.sent_at end
     from jsonb_to_recordset($1::text::jsonb) as x(id uuid, status text, reason text)
     where l.id = x.id and l.status = 'queued'`,
    [JSON.stringify(rows), ts(now)],
  );
}

/** Pushes one message to a person's devices; returns the log status. */
async function deliver(email: string, payload: PushPayload): Promise<{ status: "sent" | "failed"; reason: string | null }> {
  if (!pushEnabled()) return { status: "failed", reason: "push isn't configured on the server" };
  try {
    const r = await pushTo(email, payload);
    if (r.sent > 0) return { status: "sent", reason: null };
    return { status: "failed", reason: r.errors[0] ? r.errors[0].slice(0, 200) : "no device turned on" };
  } catch (err) {
    return { status: "failed", reason: errorMessage(err).slice(0, 200) };
  }
}

const ACTIONS = [{ action: "ack", title: "Acknowledge" }, { action: "snooze", title: "Snooze 1h" }];

function payloadFor(r: QueuedRow): PushPayload {
  const base = { id: r.id, title: r.title, body: r.body ?? "", url: r.url ?? "/tasks", kind: r.kind, severity: r.severity };
  if (r.kind === "alert" && r.task_id) return { ...base, tag: `task-${r.task_id}`, actions: ACTIONS, requireInteraction: r.severity === "critical" };
  if (r.kind === "resolved" && r.task_id) return { ...base, tag: `task-${r.task_id}` };
  return { ...base, tag: r.kind === "digest" ? `digest-${r.id}` : r.kind };
}

const WORD: Record<Severity, string> = { critical: "Critical", high: "High", medium: "Medium", low: "Low" };
const listTitles = (rows: QueuedRow[]) => {
  const lines = rows.slice(0, 3).map((r) => `${WORD[r.severity]}: ${r.title.replace(/^(Critical|High|Medium|Low): /, "")}`.slice(0, 90));
  return [...lines, ...(rows.length > 3 ? [`+${rows.length - 3} more`] : [])].join("\n");
};

type Counts = { sent: number; failed: number; suppressed: number; folded: number };

/** Sends due log rows. */
async function flush(db: Db, now: Date, team: () => Promise<Person[]>): Promise<Counts> {
  const out: Counts = { sent: 0, failed: 0, suppressed: 0, folded: 0 };
  const claimed = await db.query<QueuedRow>(
    `update alert_log set lease_until = $1::timestamptz + ${LEASE_SQL}
     where id in (
       select id from alert_log where status = 'queued' and deliver_after <= $1::timestamptz and (lease_until is null or lease_until < $1::timestamptz)
       order by deliver_after limit ${FLUSH_BATCH} for update skip locked)
       and status = 'queued' and (lease_until is null or lease_until < $1::timestamptz)
     returning id, user_email, task_id, period, kind, severity, title, body, url, reason, private`,
    [ts(now)],
  );
  if (!claimed.length) return out;

  const taskIds = [...new Set(claimed.flatMap((r) => (r.task_id ? [r.task_id] : [])))];
  const emails = [...new Set(claimed.map((r) => r.user_email))];
  const [taskRows, recentRows, members] = await Promise.all([
    db.query<TaskInfo>(`select t.id, ${TASK_COLS} from tasks t where t.id = any($1::uuid[])`, [taskIds]),
    db.query<{ user_email: string; n: number }>(
      "select user_email, count(*)::int as n from alert_log where user_email = any($1::text[]) and status = 'sent' and sent_at > $2::timestamptz group by user_email",
      [emails, ts(new Date(now.getTime() - RATE_WINDOW_MS))],
    ),
    team().then((list) => new Map(list.map((p) => [p.email, p]))),
  ]);
  const tasks = new Map(taskRows.map((t) => [t.id, t]));
  const recent = new Map(recentRows.map((r) => [r.user_email, Number(r.n)]));

  // Re-check each item right before sending: the task still in the state it
  // was about, and the person still allowed to see it.
  const drops: { id: string; status: Final; reason: string }[] = [];
  const keep: QueuedRow[] = [];
  for (const r of claimed) {
    const person = members.get(r.user_email);
    const t = r.task_id ? tasks.get(r.task_id) : null;
    const why =
      !person ? "no longer on the team"
      : r.kind !== "alert" && r.kind !== "resolved" ? null
      : !t ? "task deleted"
      : !sees(person, t) ? "no access to this task any more"
      : r.kind === "alert" && t.status !== "open" ? (t.status === "done" ? "resolved before delivery" : "snoozed before delivery")
      : r.kind === "resolved" && t.status !== "done" ? "open again before delivery"
      : null;
    if (why) drops.push({ id: r.id, status: "suppressed", reason: why });
    else keep.push(r);
  }
  await settle(db, drops, now);
  out.suppressed += drops.length;

  // Acknowledged (or otherwise handled) while we were checking: skip.
  const still = new Set((await db.query<{ id: string }>("select id from alert_log where id = any($1::uuid[]) and status = 'queued'", [keep.map((r) => r.id)])).map((r) => r.id));
  const byPerson = new Map<string, QueuedRow[]>();
  for (const r of keep) if (still.has(r.id)) byPerson.set(r.user_email, [...(byPerson.get(r.user_email) ?? []), r]);

  // The app icon badge each push carries: what's unread now plus this batch's urgent alerts.
  const badges = await urgentUnread([...byPerson.keys()]).catch(() => new Map<string, number>());
  // Each send is recorded as soon as it's made, so a run cut off midway
  // (time limit, background budget) can repeat at most the push in flight.
  await Promise.all(
    [...byPerson].map(async ([email, rows]) => {
      const appBadge = (badges.get(email) ?? 0) + rows.filter((r) => r.kind === "alert" && (r.severity === "critical" || r.severity === "high")).length;
      const digest = rows.filter((r) => r.kind === "alert" && r.reason === DIGEST_REASON);
      const instant = rows.filter((r) => !digest.includes(r)).sort((a, b) => RANK[a.severity] - RANK[b.severity]);
      const { individual, folded } = splitForRateLimit(instant, recent.get(email) ?? 0, (r) => r.severity === "critical" && r.kind === "alert");
      await Promise.all(
        individual.map(async (r) => {
          const d = await deliver(email, { ...payloadFor(r), appBadge });
          await settle(db, [{ id: r.id, ...d }], now);
          out[d.status]++;
        }),
      );
      for (const [items, title, reason] of [
        [folded, `${folded.length} more alert${folded.length === 1 ? "" : "s"}`, "rate limit: combined into one push"],
        [digest, `Noon digest: ${digest.length} item${digest.length === 1 ? "" : "s"}`, "in the noon digest"],
      ] as const) {
        if (!items.length) continue;
        const settled: { id: string; status: Final; reason: string | null }[] = [];
        await summarize(db, email, [...items], now, title, reason, out, settled, appBadge);
        await settle(db, settled, now);
      }
    }),
  );
  return out;
}

/** One push standing for several items; the items are marked folded into it. */
async function summarize(db: Db, email: string, items: QueuedRow[], now: Date, title: string, reason: string, out: Counts, results: { id: string; status: Final; reason: string | null }[], appBadge?: number) {
  const top = items.reduce((a, r) => (RANK[r.severity] < RANK[a] ? r.severity : a), "low" as Severity);
  const body = listTitles(items);
  const dedupe = `digest:${items.map((i) => i.id).sort().join(",")}`.slice(0, 400);
  // A summary naming someone's personal items is as private as they are.
  const [row] = await insertLogs(db, [{ user: email, taskId: null, period: null, kind: "digest", severity: top, title, body, url: "/tasks", status: "queued", reason, deliverAfter: now, dedupe, lease: new Date(now.getTime() + 120_000), private: items.some((i) => i.private) }]);
  if (!row) {
    // An earlier attempt made this summary (and was cut short): settle the
    // items to its outcome instead of leaving them queued forever.
    const [prev] = await db.query<{ status: string; reason: string | null }>("select status, reason from alert_log where user_email = $1 and dedupe_key = $2", [email, dedupe]);
    if (prev?.status === "sent") for (const r of items) results.push({ id: r.id, status: "folded", reason });
    else if (prev?.status === "failed") for (const r of items) results.push({ id: r.id, status: "failed", reason: prev.reason });
    // still queued: its sender holds the lease; these items come back after theirs expires
    return;
  }
  const d = await deliver(email, { ...payloadFor({ id: row.id, user_email: email, task_id: null, period: null, kind: "digest", severity: top, title, body, url: "/tasks", reason }), ...(appBadge !== undefined ? { appBadge } : {}) });
  results.push({ id: row.id, ...d });
  out[d.status]++;
  for (const r of items) results.push({ id: r.id, status: d.status === "sent" ? "folded" : "failed", reason: d.status === "sent" ? reason : d.reason });
  if (d.status === "sent") out.folded += items.length;
}

/** Settings → "Send a test": logged like any other push. */
export async function sendTest(email: string): Promise<{ status: "sent" | "failed"; reason: string | null }> {
  const db = await getDb();
  const now = new Date();
  const msg = { title: "Kaj Command Center", body: "Notifications are working. Critical items will show up here.", url: "/" };
  const [row] = await insertLogs(db, [{ user: email, taskId: null, period: null, kind: "test", severity: "low", ...msg, status: "queued", reason: null, deliverAfter: now, dedupe: `test:${now.getTime()}:${Math.random().toString(36).slice(2)}`, lease: new Date(now.getTime() + 120_000) }]);
  const d = await deliver(email, { ...msg, id: row?.id, kind: "test", tag: "test" });
  if (row) await settle(db, [{ id: row.id, ...d }], now);
  return d;
}
