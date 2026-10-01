import { getDb } from "../db";
import type { Notification, Severity } from "../../types";

export interface NewEvent {
  dedupeKey: string;
  source: string;
  kind: string;
  title: string;
  body?: string;
  severity: Severity;
  url?: string;
  business?: string;
  occurredAt?: string;
  payload?: unknown;
}

/** Stores an event once per dedupe key. Returns true when it was new. */
export async function recordEvent(e: NewEvent): Promise<boolean> {
  const db = await getDb();
  const rows = await db.query(
    `insert into events (dedupe_key, source, kind, title, body, severity, url, business, occurred_at, payload)
     values ($1, $2, $3, $4, $5, $6, $7, $8, coalesce($9::timestamptz, now()), $10::text::jsonb)
     on conflict (dedupe_key) do nothing returning id`,
    [e.dedupeKey, e.source, e.kind, e.title, e.body ?? null, e.severity, e.url ?? null, e.business ?? null, e.occurredAt ?? null, e.payload === undefined ? null : JSON.stringify(e.payload)],
  );
  return rows.length > 0;
}

export async function listEvents(limit = 200): Promise<Notification[]> {
  const db = await getDb();
  const rows = await db.query<{ id: string; source: string; title: string; body: string | null; severity: Severity; url: string | null; occurred_at: Date | string }>(
    "select id, source, title, body, severity, url, occurred_at from events order by occurred_at desc limit $1",
    [limit],
  );
  return rows.map((r) => ({
    id: r.id,
    source: r.source,
    title: r.title,
    body: r.body ?? undefined,
    severity: r.severity,
    url: r.url ?? undefined,
    at: new Date(r.occurred_at).toISOString(),
  }));
}
