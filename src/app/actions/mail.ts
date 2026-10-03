"use server";

import { requireSection } from "@/lib/server/auth";
import { fromKey } from "@/lib/mail/access";
import { changeMessage, getMessage, MailAccessError, openMailbox, type MailChange } from "@/lib/server/mail";
import { AiRefusal, aiEnabled, draftReply } from "@/lib/server/ai";
import { audit } from "@/lib/server/store/audit";
import { takeAttempt } from "@/lib/server/store/ratelimit";
import { env, errorMessage } from "@/lib/source";
import type { EmailMessage } from "@/lib/types";

// Mail client actions. Each call checks the signed-in person's access to the
// mailbox again (openMailbox); the client only names the mailbox and message.

const NEED = { read: "triage", flag: "triage", archive: "organize", delete: "organize" } as const;

export async function changeMailAction(mailbox: string, message: string, change: MailChange): Promise<{ ok?: true; error?: string }> {
  const user = await requireSection("inbox");
  const id = fromKey(message);
  if (!id || !change || !(change.kind in NEED)) return { error: "Unknown message." };
  const c: MailChange =
    change.kind === "read" ? { kind: "read", read: !!change.read } : change.kind === "flag" ? { kind: "flag", flagged: !!change.flagged } : { kind: change.kind };
  try {
    const o = await openMailbox(user, mailbox, NEED[c.kind]);
    await changeMessage(o, id, c);
    if (c.kind === "archive" || c.kind === "delete") await audit(user.email, `mail.${c.kind}`, o.h.address, null).catch(() => {});
    return { ok: true };
  } catch (err) {
    return { error: err instanceof MailAccessError ? err.message : errorMessage(err) };
  }
}

const AI_PER_HOUR = 60;

/** Claude's draft of a reply to a message, read live from the mailbox (for the reply box). */
export async function draftMailReplyAction(mailbox: string, message: string): Promise<{ draft?: string; error?: string }> {
  const user = await requireSection("inbox");
  if (!aiEnabled()) return { error: "Set ANTHROPIC_API_KEY to draft replies." };
  const id = fromKey(message);
  if (!id) return { error: "Unknown message." };
  try {
    const o = await openMailbox(user, mailbox, "read");
    const m = await getMessage(o, id);
    if ((await takeAttempt(`ai:${user.email}`, 3600)) > AI_PER_HOUR) return { error: `You've reached ${AI_PER_HOUR} AI requests this hour.` };
    const email: EmailMessage = {
      id: `${o.h.id}:${m.id}`,
      from: m.from ? `${m.from.name} <${m.from.address}>` : "",
      subject: m.subject,
      snippet: m.text.slice(0, 6000),
      receivedAt: m.receivedAt,
      unread: m.unread,
      account: o.h.label,
      mailbox: o.h.id,
      labels: [],
      severity: "medium",
    };
    const draft = await draftReply(email, env("OWNER_NAME") ?? "Kaj Consulting");
    await audit(user.email, "ai.draft_reply", o.h.owner ? "my mailbox" : o.h.label, null);
    return { draft };
  } catch (err) {
    return { error: err instanceof AiRefusal || err instanceof MailAccessError ? err.message : `Couldn't draft a reply (${errorMessage(err)}).` };
  }
}
