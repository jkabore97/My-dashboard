import { canSeeTask } from "../../access";
import { businessTimeZone } from "../../dates";
import { errorMessage } from "../../source";
import type { Severity } from "../../types";
import { getDb, type Db } from "../db";
import { pushEnabled, pushText, pushTo, type PushPayload } from "../notify";
import { people, type Person } from "../people";
import { decide, splitForRateLimit, DIGEST_REASON, RATE_WINDOW_MS, WEBSITE_CONFIRM_MS } from "./decide";
import { prefsFor } from "./store";

// Alert routing. Tasks are the incidents: each task has one row in
// alert_incidents tracking its current open period.
//
//   1. open tasks without an incident → incident (period 1)
//   2. closed incidents whose task is open again → next period
//   3. open incidents whose task is done → closed; "Resolved" to those alerted
//   4. incidents due for routing (website ones after a second check) → one
//      delivery-log row per person who can see the task, sent now, queued
//      until quiet hours / a pause end, or for the noon digest
//   5. due log rows → re-checked (task still open, person still allowed) and
//      pushed, folding anything over the rate limit into one summary
//
// Every step claims its rows with a single conditional UPDATE/INSERT
// (… returning), and log rows are unique per (person, message), so two runs
// at once never send the same thing twice. Everything is fail-soft.

const RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const SEV_SQL = "array['critical','high','medium','low']";
/** Tasks older than this when first seen existed before alerting did: tracked, never pushed. */
const FRESH_SQL = "interval '1 day'";
const LEASE_SQL = "interval '2 minutes'";
const FLUSH_BATCH = 300;

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
}

const ts = (d: Date) => d.toISOString();
const sees = (p: Person, t: Pick<TaskInfo, "business" | "source_key" | "assignee">) => canSeeTask(p, p.email, { business: t.business, sourceKey: t.source_key, assignee: t.assignee });

export function resolvedText(t: Pick<TaskInfo, "title" | "detail" | "source_key" | "origin">, severity: Severity) {
  const p = pushText(t, severity);
  const email = p.title.endsWith(" email");
  return email ? { title: `Resolved: ${p.title}`, body: p.body } : { title: `Resolved: ${t.title}`.slice(0, 120), body: "Cleared. No action needed any more." };
}

/** Runs every step once. Safe to call from anywhere, any number of times at once. */
export async function runAlerts(opts: { now?: Date } = {}): Promise<AlertRunSummary> {
  const now = opts.now ?? new Date();
  const db = await getDb();
  const sum: AlertRunSummary = { opened: 0, reopened: 0, closed: 0, routed: 0, sent: 0, failed: 0, suppressed: 0, folded: 0 };
  let everyone: Person[] | null = null;
  const team = async () => (everyone ??= await people());

  // Snoozes that ran out count as open again (the To-do page does the same).
  await db.query("update tasks set status = 'open', snoozed_until = null, updated_at = now() where status = 'snoozed' and snoozed_until <= $1::timestamptz", [ts(now)]);

  const routeAfter = `case when t.source_key like 'websites/%' then $1::timestamptz + make_interval(secs => $2) else $1::timestamptz end`;
  sum.opened = (
    await db.query(
      `insert into alert_incidents (task_id, opened_at, route_after)
       select t.id, $1::timestamptz,
         case when t.created_at > $1::timestamptz - ${FRESH_SQL} or t.occurred_at > $1::timestamptz - ${FRESH_SQL} then ${routeAfter} else 'infinity'::timestamptz end
       from tasks t where t.status = 'open' and not exists (select 1 from alert_incidents i where i.task_id = t.id)
       on conflict (task_id) do nothing returning task_id`,
      [ts(now), WEBSITE_CONFIRM_MS / 1000],
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

  const closed = await db.query<TaskInfo & { period: number; routed_severity: Severity | null }>(
    `update alert_incidents i set state = 'closed', closed_at = $1::timestamptz, updated_at = now()
     from tasks t where t.id = i.task_id and i.state = 'open' and t.status = 'done'
     returning i.task_id as id, i.period, i.routed_severity, t.title, t.detail, t.source_key, t.origin, t.severity, t.status,
       coalesce(t.business_override, t.business) as business, t.assignee`,
    [ts(now)],
  );
  sum.closed = closed.length;
  for (const inc of closed) {
    // Whatever still waits (quiet hours, the digest) about it is moot now.
    await db.query(
      "update alert_log set status = 'suppressed', reason = 'resolved before delivery', lease_until = null where task_id = $1 and period = $2 and kind = 'alert' and status = 'queued'",
      [inc.id, inc.period],
    );
    if (inc.routed_severity !== "critical" && inc.routed_severity !== "high") continue;
    // Only the people who actually got the alert hear that it's over.
    const got = await db.query<{ user_email: string }>(
      "select distinct user_email from alert_log where task_id = $1 and period = $2 and kind = 'alert' and status in ('sent', 'folded')",
      [inc.id, inc.period],
    );
    if (!got.length) continue;
    const prefs = await prefsFor(got.map((g) => g.user_email));
    const text = resolvedText(inc, inc.routed_severity);
    for (const { user_email } of got) {
      const d = decide({ severity: inc.routed_severity, kind: "resolved", prefs: prefs.get(user_email)!, now, fallbackZone: businessTimeZone() });
      await insertLog(db, {
        user: user_email, taskId: inc.id, period: inc.period, kind: "resolved", severity: inc.routed_severity, ...text, url: "/tasks",
        status: d.action === "now" ? "queued" : "suppressed", reason: d.action === "skip" ? d.reason : null, deliverAfter: now, dedupe: `resolved:${inc.id}:${inc.period}`,
      });
    }
  }

  const due = await db.query<TaskInfo & { period: number }>(
    `update alert_incidents i set routed_severity = t.severity, updated_at = now()
     from tasks t where t.id = i.task_id and i.state = 'open' and t.status = 'open' and i.route_after <= $1::timestamptz
       and (i.routed_severity is null or array_position(${SEV_SQL}, t.severity) < array_position(${SEV_SQL}, i.routed_severity))
     returning i.task_id as id, i.period, t.title, t.detail, t.source_key, t.origin, t.severity, t.status,
       coalesce(t.business_override, t.business) as business, t.assignee`,
    [ts(now)],
  );
  for (const t of due) {
    sum.routed++;
    if (t.severity === "low") continue; // never pushed; the morning brief covers it
    const to = (await team()).filter((p) => sees(p, t));
    if (!to.length) continue;
    // An escalation replaces what was still waiting at the lower severity.
    await db.query(
      "update alert_log set status = 'suppressed', reason = 'escalated', lease_until = null where task_id = $1 and period = $2 and status = 'queued' and kind = 'alert'",
      [t.id, t.period],
    );
    const prefs = await prefsFor(to.map((p) => p.email));
    const text = pushText(t, t.severity);
    for (const p of to) {
      const d = decide({ severity: t.severity, kind: "alert", prefs: prefs.get(p.email)!, now, fallbackZone: businessTimeZone() });
      await insertLog(db, {
        user: p.email, taskId: t.id, period: t.period, kind: "alert", severity: t.severity, ...text, url: "/tasks",
        status: d.action === "skip" ? "suppressed" : "queued",
        reason: d.action === "now" ? null : d.reason,
        deliverAfter: d.action === "queue" ? d.until : now,
        dedupe: `alert:${t.id}:${t.period}:${t.severity}`,
      });
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

interface NewLog {
  user: string;
  taskId: string | null;
  period: number | null;
  kind: QueuedRow["kind"];
  severity: Severity;
  title: string;
  body: string | null;
  url: string;
  status: "queued" | "suppressed" | "sent" | "failed";
  reason: string | null;
  deliverAfter: Date;
  dedupe: string;
  lease?: boolean;
}

async function insertLog(db: Db, l: NewLog): Promise<string | null> {
  const [row] = await db.query<{ id: string }>(
    `insert into alert_log (user_email, task_id, period, kind, severity, title, body, url, status, reason, deliver_after, dedupe_key, lease_until)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::timestamptz, $12, case when $13 then $11::timestamptz + ${LEASE_SQL} end)
     on conflict (user_email, dedupe_key) do nothing returning id`,
    [l.user, l.taskId, l.period, l.kind, l.severity, l.title.slice(0, 200), l.body?.slice(0, 300) ?? null, l.url, l.status, l.reason, ts(l.deliverAfter), l.dedupe, !!l.lease],
  );
  return row?.id ?? null;
}

async function finish(db: Db, id: string, status: "sent" | "failed" | "suppressed" | "folded", reason: string | null, now: Date) {
  await db.query(
    `update alert_log set status = $2, reason = coalesce($3, reason), lease_until = null,
       sent_at = case when $2 in ('sent', 'folded') then $4::timestamptz else sent_at end
     where id = $1 and status = 'queued'`,
    [id, status, reason, ts(now)],
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

/** Sends due log rows. */
async function flush(db: Db, now: Date, team: () => Promise<Person[]>) {
  const out = { sent: 0, failed: 0, suppressed: 0, folded: 0 };
  const claimed = await db.query<QueuedRow>(
    `update alert_log set lease_until = $1::timestamptz + ${LEASE_SQL}
     where id in (
       select id from alert_log where status = 'queued' and deliver_after <= $1::timestamptz and (lease_until is null or lease_until < $1::timestamptz)
       order by deliver_after limit ${FLUSH_BATCH} for update skip locked)
       and status = 'queued' and (lease_until is null or lease_until < $1::timestamptz)
     returning id, user_email, task_id, period, kind, severity, title, body, url, reason`,
    [ts(now)],
  );
  if (!claimed.length) return out;

  const ids = [...new Set(claimed.flatMap((r) => (r.task_id ? [r.task_id] : [])))];
  const tasks = new Map(
    (await db.query<TaskInfo>(
      "select id, title, detail, source_key, origin, severity, status, coalesce(business_override, business) as business, assignee from tasks where id = any($1::uuid[])",
      [ids],
    )).map((t) => [t.id, t]),
  );
  const byPerson = new Map<string, QueuedRow[]>();
  for (const r of claimed) byPerson.set(r.user_email, [...(byPerson.get(r.user_email) ?? []), r]);
  const members = new Map((await team()).map((p) => [p.email, p]));

  const drop = async (r: QueuedRow, reason: string) => {
    await finish(db, r.id, "suppressed", reason, now);
    out.suppressed++;
  };

  await Promise.all(
    [...byPerson].map(async ([email, rows]) => {
      const person = members.get(email);
      // Re-check each item right before sending: task still in the state it was
      // about, and the person still allowed to see it.
      const keep: QueuedRow[] = [];
      for (const r of rows) {
        if (!person) {
          await drop(r, "no longer on the team");
          continue;
        }
        if (r.kind === "alert" || r.kind === "resolved") {
          const t = r.task_id ? tasks.get(r.task_id) : null;
          if (!t) await drop(r, "task deleted");
          else if (!sees(person, t)) await drop(r, "no access to this task any more");
          else if (r.kind === "alert" && t.status !== "open") await drop(r, t.status === "done" ? "resolved before delivery" : "snoozed before delivery");
          else if (r.kind === "resolved" && t.status !== "done") await drop(r, "open again before delivery");
          else keep.push(r);
        } else keep.push(r);
      }
      // Acknowledged (or otherwise handled) while we were checking: skip.
      const still = new Set((await db.query<{ id: string }>("select id from alert_log where id = any($1::uuid[]) and status = 'queued'", [keep.map((r) => r.id)])).map((r) => r.id));
      const ready = keep.filter((r) => still.has(r.id));

      const digest = ready.filter((r) => r.kind === "alert" && r.reason === DIGEST_REASON);
      const instant = ready.filter((r) => !digest.includes(r)).sort((a, b) => RANK[a.severity] - RANK[b.severity]);

      const [{ n }] = await db.query<{ n: number }>(
        "select count(*)::int as n from alert_log where user_email = $1 and status = 'sent' and sent_at > $2::timestamptz",
        [email, ts(new Date(now.getTime() - RATE_WINDOW_MS))],
      );
      const { individual, folded } = splitForRateLimit(instant, Number(n));

      for (const r of individual) {
        const d = await deliver(email, payloadFor(r));
        await finish(db, r.id, d.status, d.reason, now);
        out[d.status]++;
      }
      if (folded.length) await summarize(db, email, folded, now, `${folded.length} more alert${folded.length === 1 ? "" : "s"}`, "rate limit: combined into one push", out);
      if (digest.length) await summarize(db, email, digest, now, `Noon digest: ${digest.length} item${digest.length === 1 ? "" : "s"}`, "in the noon digest", out);
    }),
  );
  return out;
}

/** One push standing for several items; the items are marked folded into it. */
async function summarize(db: Db, email: string, items: QueuedRow[], now: Date, title: string, reason: string, out: { sent: number; failed: number; folded: number }) {
  const top = items.reduce((a, r) => (RANK[r.severity] < RANK[a] ? r.severity : a), "low" as Severity);
  const body = listTitles(items);
  const id = await insertLog(db, { user: email, taskId: null, period: null, kind: "digest", severity: top, title, body, url: "/tasks", status: "queued", reason, deliverAfter: now, dedupe: `digest:${items.map((i) => i.id).sort().join(",").slice(0, 400)}`, lease: true });
  if (!id) return;
  const d = await deliver(email, payloadFor({ id, user_email: email, task_id: null, period: null, kind: "digest", severity: top, title, body, url: "/tasks", reason }));
  await finish(db, id, d.status, d.reason, now);
  out[d.status]++;
  for (const r of items) {
    if (d.status === "sent") await finish(db, r.id, "folded", reason, now);
    else await finish(db, r.id, "failed", d.reason, now);
  }
  if (d.status === "sent") out.folded += items.length;
}

/** Settings → "Send a test": logged like any other push. */
export async function sendTest(email: string): Promise<{ status: "sent" | "failed"; reason: string | null }> {
  const db = await getDb();
  const now = new Date();
  const msg = { title: "Kaj Command Center", body: "Notifications are working. Critical items will show up here.", url: "/" };
  const id = await insertLog(db, { user: email, taskId: null, period: null, kind: "test", severity: "low", ...msg, status: "queued", reason: null, deliverAfter: now, dedupe: `test:${now.getTime()}:${Math.random().toString(36).slice(2)}`, lease: true });
  const d = await deliver(email, { ...msg, id: id ?? undefined, kind: "test", tag: "test" });
  if (id) await finish(db, id, d.status, d.reason, now);
  return d;
}
