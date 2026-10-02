import { getDb } from "../db";
import { SEVERITY_ORDER, type Severity, type Task } from "../../types";

export type TaskStatus = "open" | "snoozed" | "done";
export type TaskOrigin = "derived" | "manual" | "event";

export interface StoredTask extends Task {
  origin: TaskOrigin;
  sourceKey: string | null;
  status: TaskStatus;
  snoozedUntil: string | null;
  resolvedBy: "user" | "auto" | null;
  resolvedAt: string | null;
}

interface TaskRow {
  id: string;
  origin: TaskOrigin;
  source_key: string | null;
  title: string;
  detail: string | null;
  severity: Severity;
  source: string;
  url: string | null;
  business: string | null;
  business_override: string | null;
  status: TaskStatus;
  snoozed_until: Date | string | null;
  resolved_by: "user" | "auto" | null;
  resolved_at: Date | string | null;
  occurred_at: Date | string;
}

const iso = (v: Date | string | null) => (v == null ? null : new Date(v).toISOString());

function toTask(r: TaskRow): StoredTask {
  return {
    id: r.id,
    title: r.title,
    detail: r.detail ?? undefined,
    severity: r.severity,
    source: r.source,
    url: r.url ?? undefined,
    business: r.business_override ?? r.business ?? undefined,
    createdAt: iso(r.occurred_at)!,
    origin: r.origin,
    sourceKey: r.source_key,
    status: r.status,
    snoozedUntil: iso(r.snoozed_until),
    resolvedBy: r.resolved_by,
    resolvedAt: iso(r.resolved_at),
  };
}

export function sortTasks<T extends Task>(tasks: T[]): T[] {
  return tasks.sort(
    (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) || b.createdAt.localeCompare(a.createdAt),
  );
}

/** Wakes snoozed tasks whose time has come, then lists tasks in one state. */
export async function listTasks(status: TaskStatus, limit = 500): Promise<StoredTask[]> {
  const db = await getDb();
  await db.query("update tasks set status = 'open', snoozed_until = null, updated_at = now() where status = 'snoozed' and snoozed_until <= now()");
  const order = status === "done" ? "resolved_at desc nulls last" : "occurred_at desc";
  const rows = await db.query<TaskRow>(`select * from tasks where status = $1 order by ${order} limit $2`, [status, limit]);
  const tasks = rows.map(toTask);
  return status === "done" ? tasks : sortTasks(tasks);
}

export async function getTask(id: string) {
  const db = await getDb();
  const [row] = await db.query<TaskRow>("select * from tasks where id = $1", [id]);
  return row ? toTask(row) : null;
}

/**
 * Syncs auto-generated tasks with the latest signals. `derived` must be the
 * complete current list (keyed by Task.id = "<scope>/<key>") for every scope
 * in `scopes`; tasks belonging to other scopes, or whose key starts with one
 * of the `unobserved` prefixes, are left untouched.
 *  - new condition            -> open task
 *  - condition still present  -> refresh title/severity, keep user's status
 *  - condition gone           -> auto-resolve (so it reopens if it comes back)
 *  - condition back after an auto-resolve -> reopen
 */
export async function reconcileDerived(derived: Task[], scopes: string[], unobserved: string[] = []) {
  const db = await getDb();
  await db.tx(async (tx) => {
    const existing = await tx.query<{ source_key: string; status: TaskStatus; resolved_by: string | null }>(
      "select source_key, status, resolved_by from tasks where origin = 'derived'",
    );
    const byKey = new Map(existing.map((r) => [r.source_key, r]));
    const seen = new Set<string>();
    for (const t of derived) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      const prev = byKey.get(t.id);
      const reopen = prev?.status === "done" && prev.resolved_by === "auto";
      await tx.query(
        `insert into tasks (origin, source_key, title, detail, severity, source, url, business, occurred_at)
         values ('derived', $1, $2, $3, $4, $5, $6, $7, $8::timestamptz)
         on conflict (source_key) do update set
           title = excluded.title, detail = excluded.detail, severity = excluded.severity,
           source = excluded.source, url = excluded.url, business = excluded.business,
           status = case when $9 then 'open' else tasks.status end,
           resolved_by = case when $9 then null else tasks.resolved_by end,
           resolved_at = case when $9 then null else tasks.resolved_at end,
           occurred_at = case when $9 then excluded.occurred_at else tasks.occurred_at end,
           updated_at = now()`,
        [t.id, t.title, t.detail ?? null, t.severity, t.source, t.url ?? null, t.business ?? null, t.createdAt, reopen],
      );
    }
    const inScope = (key: string) => scopes.some((sc) => key.startsWith(`${sc}/`)) && !unobserved.some((p) => key.startsWith(p));
    const gone = existing.map((r) => r.source_key).filter((k) => !seen.has(k) && inScope(k));
    if (gone.length) {
      await tx.query(
        `update tasks set status = 'done', resolved_by = 'auto', resolved_at = coalesce(case when resolved_by = 'user' then resolved_at end, now()),
           snoozed_until = null, updated_at = now()
         where origin = 'derived' and source_key = any($1::text[]) and (status <> 'done' or resolved_by = 'user')`,
        [gone],
      );
    }
  });
}

/** Creates (or reopens, if it had auto-resolved) a task from a webhook event. Idempotent per key. */
export async function upsertEventTask(key: string, t: Omit<Task, "id">) {
  const db = await getDb();
  await db.query(
    `insert into tasks (origin, source_key, title, detail, severity, source, url, business, occurred_at)
     values ('event', $1, $2, $3, $4, $5, $6, $7, $8::timestamptz)
     on conflict (source_key) do update set
       title = excluded.title, detail = excluded.detail, severity = excluded.severity, url = excluded.url,
       status = case when tasks.status = 'done' and tasks.resolved_by = 'auto' then 'open' else tasks.status end,
       occurred_at = case when tasks.status = 'done' and tasks.resolved_by = 'auto' then excluded.occurred_at else tasks.occurred_at end,
       resolved_at = case when tasks.status = 'done' and tasks.resolved_by = 'auto' then null else tasks.resolved_at end,
       resolved_by = case when tasks.status = 'done' and tasks.resolved_by = 'auto' then null else tasks.resolved_by end,
       updated_at = now()`,
    [key, t.title, t.detail ?? null, t.severity, t.source, t.url ?? null, t.business ?? null, t.createdAt],
  );
}

/**
 * Which of these keys are webhook (event) tasks that are still open or
 * snoozed. A closed webhook task no longer stands in for the polled one, so a
 * problem that's still there (an invoice still unpaid) gets its task back.
 */
export async function existingEventKeys(keys: string[]): Promise<Set<string>> {
  if (!keys.length) return new Set();
  const db = await getDb();
  const rows = await db.query<{ source_key: string }>("select source_key from tasks where origin = 'event' and status <> 'done' and source_key = any($1::text[])", [keys]);
  return new Set(rows.map((r) => r.source_key));
}

/**
 * Closes an event task when the platform reports the problem resolved. A task
 * the user already marked done becomes auto-resolved too, so the next
 * occurrence reopens it (upsertEventTask only reopens auto-resolved tasks).
 */
export async function resolveEventTask(key: string) {
  const db = await getDb();
  await db.query(
    `update tasks set status = 'done', resolved_by = 'auto', resolved_at = coalesce(case when status = 'done' then resolved_at end, now()),
       snoozed_until = null, updated_at = now()
     where source_key = $1 and origin = 'event' and (status <> 'done' or resolved_by = 'user')`,
    [key],
  );
}

export async function addManualTask(t: { title: string; detail?: string; severity: Severity; business?: string; url?: string }) {
  const db = await getDb();
  const [row] = await db.query<TaskRow>(
    `insert into tasks (origin, title, detail, severity, source, url, business)
     values ('manual', $1, $2, $3, 'Manual', $4, $5) returning *`,
    [t.title, t.detail ?? null, t.severity, t.url ?? null, t.business ?? null],
  );
  return toTask(row);
}

export async function completeTask(id: string) {
  const db = await getDb();
  await db.query(
    "update tasks set status = 'done', resolved_by = 'user', resolved_at = now(), snoozed_until = null, updated_at = now() where id = $1",
    [id],
  );
}

export async function reopenTask(id: string) {
  const db = await getDb();
  await db.query(
    "update tasks set status = 'open', resolved_by = null, resolved_at = null, snoozed_until = null, updated_at = now() where id = $1",
    [id],
  );
}

export async function snoozeTask(id: string, until: Date) {
  const db = await getDb();
  await db.query(
    "update tasks set status = 'snoozed', snoozed_until = $2::timestamptz, updated_at = now() where id = $1 and status <> 'done'",
    [id, until.toISOString()],
  );
}

export async function setTaskBusiness(id: string, business: string | null) {
  const db = await getDb();
  await db.query("update tasks set business_override = $2, updated_at = now() where id = $1", [id, business]);
}

export async function deleteManualTask(id: string) {
  const db = await getDb();
  await db.query("delete from tasks where id = $1 and origin = 'manual'", [id]);
}
