import type { EmailMessage, Severity } from "../types";
import { errorMessage } from "../source";
import { aiEnabled, triageEmails, type Triage } from "./ai";
import { getDb } from "./db";

// AI triage results are cached per message id, so each email is read by
// Claude once. Cron triages new unread mail in small batches; pages only read.

export async function cachedTriage(ids: string[]): Promise<Map<string, Triage>> {
  if (!ids.length) return new Map();
  const db = await getDb();
  const rows = await db.query<{ message_id: string; severity: Severity; summary: string; needs_reply: boolean; task: string | null }>(
    "select message_id, severity, summary, needs_reply, task from email_triage where message_id = any($1::text[])",
    [ids],
  );
  return new Map(rows.map((r) => [r.message_id, { severity: r.severity, summary: r.summary, needsReply: r.needs_reply, task: r.task }]));
}

/** Applies cached AI severity to messages; unchanged when AI is off or the database is down. */
export async function withTriage(emails: EmailMessage[]): Promise<EmailMessage[]> {
  if (!aiEnabled() || !emails.length) return emails;
  try {
    const map = await cachedTriage(emails.map((e) => e.id));
    return emails.map((e) => {
      const t = map.get(e.id);
      return t ? { ...e, severity: t.severity, triage: t } : e;
    });
  } catch {
    return emails;
  }
}

/** Triages up to `limit` unread messages that have no result yet. Returns how many were triaged. */
export async function triagePending(emails: EmailMessage[], limit = 25): Promise<number> {
  if (!aiEnabled()) return 0;
  const unread = emails.filter((e) => e.unread);
  const known = await cachedTriage(unread.map((e) => e.id));
  const todo = unread.filter((e) => !known.has(e.id)).slice(0, limit);
  if (!todo.length) return 0;
  let results: Map<string, Triage>;
  try {
    results = await triageEmails(todo);
  } catch (err) {
    console.error(`[triage] ${errorMessage(err)}`);
    return 0;
  }
  const db = await getDb();
  for (const [id, t] of results) {
    await db.query(
      "insert into email_triage (message_id, severity, summary, needs_reply, task) values ($1, $2, $3, $4, $5) on conflict (message_id) do nothing",
      [id, t.severity, t.summary, t.needsReply, t.task],
    );
  }
  return results.size;
}
