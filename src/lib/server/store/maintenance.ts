import { getDb } from "../db";

/** Keeps the database small: old events, snapshots, audit rows and done tasks. */
export async function pruneOldData() {
  const db = await getDb();
  await db.query("delete from events where occurred_at < now() - interval '90 days'");
  await db.query("delete from snapshots where taken_at < now() - interval '30 days'");
  await db.query("delete from audit_log where at < now() - interval '365 days'");
  await db.query("delete from tasks where status = 'done' and resolved_at < now() - interval '90 days'");
  await db.query("delete from email_triage where created_at < now() - interval '60 days'");
  await db.query("delete from alert_log where created_at < now() - interval '90 days'");
  await db.query("delete from rate_limits where window_start < now() - interval '1 day'");
  await db.query("delete from settings where (key like 'job:brief:%' or key like 'job:weekly:%' or key like 'push:%') and updated_at < now() - interval '30 days'");
}
