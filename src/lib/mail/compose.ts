import { fromKey, parseAddressList } from "./access";
import { formatBytes, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS, MAX_BODY, MAX_RECIPIENTS, MAX_SUBJECT, MAX_TOTAL_ATTACHMENT_BYTES } from "./limits";
import type { ComposeMode, OutgoingAttachment, SendRequest } from "./types";

const MODES: ComposeMode[] = ["new", "reply", "replyAll", "forward"];

/**
 * The composer's form → a SendRequest, validated: a known mode, a message for
 * replies and forwards, at least one recipient, real addresses, and the size
 * limits. The mailbox key is returned as is; the caller checks access to it.
 */
export async function parseSendForm(form: FormData): Promise<{ mailbox: string; req: SendRequest } | { error: string }> {
  const str = (k: string) => (typeof form.get(k) === "string" ? (form.get(k) as string) : "");
  const mailbox = str("mailbox");
  const mode = str("mode") as ComposeMode;
  if (!mailbox) return { error: "No mailbox chosen." };
  if (!MODES.includes(mode)) return { error: "Unknown kind of message." };
  let messageId: string | undefined;
  if (mode !== "new") {
    const id = fromKey(str("message"));
    if (!id) return { error: "The message you're answering is missing." };
    messageId = id;
  }
  const lists: Record<"to" | "cc" | "bcc", SendRequest["to"]> = { to: [], cc: [], bcc: [] };
  for (const k of ["to", "cc", "bcc"] as const) {
    const r = parseAddressList(str(k));
    if ("error" in r) return { error: `${k === "to" ? "To" : k === "cc" ? "Cc" : "Bcc"}: ${r.error}` };
    lists[k] = r.list;
  }
  const count = lists.to.length + lists.cc.length + lists.bcc.length;
  if (count === 0) return { error: "Add at least one recipient." };
  if (count > MAX_RECIPIENTS) return { error: `At most ${MAX_RECIPIENTS} recipients.` };
  const subject = str("subject").replace(/[\r\n]+/g, " ").trim();
  if (subject.length > MAX_SUBJECT) return { error: "The subject is too long." };
  const body = str("body");
  if (body.length > MAX_BODY) return { error: "The message is too long." };
  if (!body.trim() && mode !== "forward") return { error: "Write a message first." };
  const files = form.getAll("files").filter((f): f is File => typeof f === "object" && f !== null && "arrayBuffer" in f && (f as File).size > 0);
  if (files.length > MAX_ATTACHMENTS) return { error: `At most ${MAX_ATTACHMENTS} attachments.` };
  let total = 0;
  const attachments: OutgoingAttachment[] = [];
  for (const f of files) {
    if (f.size > MAX_ATTACHMENT_BYTES) return { error: `${f.name} is larger than ${formatBytes(MAX_ATTACHMENT_BYTES)}.` };
    total += f.size;
    if (total > MAX_TOTAL_ATTACHMENT_BYTES) return { error: `Attachments add up to more than ${formatBytes(MAX_TOTAL_ATTACHMENT_BYTES)}.` };
    attachments.push({ name: (f.name || "attachment").slice(0, 200), contentType: f.type || "application/octet-stream", data: new Uint8Array(await f.arrayBuffer()) });
  }
  return { mailbox, req: { mode, ...(messageId ? { messageId } : {}), ...lists, subject, body, attachments } };
}

/** Only the dashboard's own pages may post here (the session cookie is SameSite=Lax; this closes the rest). */
export function sameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return !!host && new URL(origin).host === host;
  } catch {
    return false;
  }
}
