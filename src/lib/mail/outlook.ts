import { callSignal } from "../source";
import { htmlToText, prependToHtmlBody, replaceCid, textToHtml } from "./html";
import { PAGE_SIZE } from "./limits";
import type { MailAddress, MailAttachment, MailFolder, MailListItem, MailMessage, MailPage, OutgoingAttachment, SendRequest, WellKnownFolder } from "./types";

// Outlook / Microsoft 365 mail through Microsoft Graph, fetched live per
// request (never through the shared dashboard cache). Every function takes an
// access token for one mailbox; the caller (src/lib/server/mail.ts) decides
// whether the viewer may use that mailbox before asking for the token.

export const GRAPH = "https://graph.microsoft.com/v1.0";

export class MailApiError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

/** Graph's error as one readable line; access errors point at reconnecting. */
function graphError(status: number, body: { error?: { code?: string; message?: string } }): MailApiError {
  const code = body.error?.code;
  if (status === 403 || code === "ErrorAccessDenied" || code === "AccessDenied") {
    return new MailApiError(status, "Microsoft refused: this mailbox's connection doesn't allow that. Reconnect it (Platforms, or Settings → My mail) to grant read/write and send.", code);
  }
  if (status === 404) return new MailApiError(status, "That message or folder no longer exists (moved or deleted).", code);
  if (status === 429) return new MailApiError(status, "Microsoft is rate-limiting this mailbox. Try again in a minute.", code);
  return new MailApiError(status, `${status} from Microsoft Graph: ${body.error?.message ?? "request failed"}`, code);
}

async function call<T>(token: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(`${GRAPH}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    cache: "no-store",
    signal: callSignal(20_000),
  });
  if (!res.ok) throw graphError(res.status, (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } });
  if (res.status === 202 || res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

// ─── Folders ─────────────────────────────────────────────────────────────────

/** Graph's well-known folder names. */
export const OUTLOOK_FOLDERS: Record<WellKnownFolder, string> = { inbox: "inbox", sent: "sentitems", drafts: "drafts", archive: "archive", junk: "junkemail", deleted: "deleteditems" };
const FOLDER_LABEL: Record<WellKnownFolder, string> = { inbox: "Inbox", sent: "Sent", drafts: "Drafts", archive: "Archive", junk: "Junk", deleted: "Deleted" };

const FOLDER_ID = /^[A-Za-z0-9_\-=+/.]{1,512}$/;
export const validFolder = (f: string) => FOLDER_ID.test(f) && !f.includes("..");

interface GraphFolder {
  id: string;
  displayName: string;
  unreadItemCount?: number;
  totalItemCount?: number;
}

const toFolder = (f: GraphFolder, wellKnown?: WellKnownFolder): MailFolder => ({
  id: wellKnown ? OUTLOOK_FOLDERS[wellKnown] : f.id,
  name: wellKnown ? FOLDER_LABEL[wellKnown] : f.displayName,
  unread: f.unreadItemCount ?? null,
  total: f.totalItemCount ?? null,
  ...(wellKnown ? { wellKnown } : {}),
});

/** The well-known folders (one $batch call), then the mailbox's other top-level folders. */
export async function listOutlookFolders(token: string): Promise<MailFolder[]> {
  const sel = "$select=id,displayName,unreadItemCount,totalItemCount";
  const known = Object.keys(OUTLOOK_FOLDERS) as WellKnownFolder[];
  const res = await call<{ responses: { id: string; status: number; body: GraphFolder & { value?: GraphFolder[] } }[] }>(token, "POST", "/$batch", {
    requests: [
      ...known.map((k) => ({ id: k, method: "GET", url: `/me/mailFolders/${OUTLOOK_FOLDERS[k]}?${sel}` })),
      { id: "all", method: "GET", url: `/me/mailFolders?$top=100&${sel}` },
    ],
  });
  const byId = new Map(res.responses.map((r) => [r.id, r]));
  const out: MailFolder[] = [];
  const knownIds = new Set<string>();
  for (const k of known) {
    const r = byId.get(k);
    if (r && r.status === 200) {
      out.push(toFolder(r.body, k));
      knownIds.add(r.body.id);
    }
  }
  const all = byId.get("all");
  if (all?.status === 200) {
    for (const f of all.body.value ?? []) if (!knownIds.has(f.id) && validFolder(f.id)) out.push(toFolder(f));
  }
  if (!out.length) throw new MailApiError(all?.status ?? 500, "Couldn't read this mailbox's folders.");
  return out;
}

// ─── Listing ─────────────────────────────────────────────────────────────────

export const LIST_SELECT = "id,subject,from,toRecipients,receivedDateTime,isRead,bodyPreview,hasAttachments,flag,importance,isDraft";

/** A search as a KQL phrase: quotes and backslashes dropped, length capped. */
export const kqlPhrase = (q: string) => `"${q.replace(/["\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200)}"`;

export interface ListOptions {
  folder: string;
  search?: string | null;
  unread?: boolean;
  top?: number;
}

/**
 * The first page's Graph path. Newest first; "unread" filters on isRead
 * (receivedDateTime has to lead the filter when it's the sort order).
 * A search uses $search, which Graph doesn't combine with $orderby or $filter:
 * results come newest first anyway and "unread" is applied to them here.
 */
export function buildOutlookListPath(o: ListOptions): string {
  if (!validFolder(o.folder)) throw new MailApiError(400, "Unknown folder.");
  const top = String(Math.max(1, Math.min(100, o.top ?? PAGE_SIZE)));
  const search = o.search?.trim();
  const q = new URLSearchParams({ $top: top, $select: LIST_SELECT });
  if (search) q.set("$search", kqlPhrase(search));
  else {
    q.set("$orderby", "receivedDateTime desc");
    if (o.unread) q.set("$filter", "receivedDateTime ge 1900-01-01T00:00:00Z and isRead eq false");
  }
  return `/me/mailFolders/${encodeURIComponent(o.folder)}/messages?${q}`;
}

/** @odata.nextLink → the path after /v1.0 (what the next page's cursor holds). */
export function outlookCursor(nextLink: string | undefined | null): string | null {
  if (!nextLink || !nextLink.startsWith(`${GRAPH}/`)) return null;
  const path = nextLink.slice(GRAPH.length);
  return validOutlookCursor(path) ? path : null;
}

/** A cursor comes back from the browser: only a message list of this mailbox is accepted. */
export function validOutlookCursor(c: string): boolean {
  return c.length < 4096 && /^\/me\/mailFolders\/[A-Za-z0-9_\-=+%.]+\/messages\?/.test(c) && !c.includes("://") && !c.includes("..") && !c.includes("#");
}

interface GraphRecipient {
  emailAddress?: { name?: string; address?: string };
}

interface GraphMessage {
  id: string;
  subject: string | null;
  bodyPreview?: string;
  receivedDateTime: string;
  sentDateTime?: string | null;
  isRead: boolean;
  isDraft?: boolean;
  hasAttachments?: boolean;
  importance?: "low" | "normal" | "high";
  flag?: { flagStatus?: "notFlagged" | "flagged" | "complete" };
  from?: GraphRecipient;
  toRecipients?: GraphRecipient[];
  ccRecipients?: GraphRecipient[];
  bccRecipients?: GraphRecipient[];
  replyTo?: GraphRecipient[];
  body?: { contentType: "html" | "text"; content: string };
  webLink?: string;
}

export const fromRecipient = (r: GraphRecipient | undefined): MailAddress | null =>
  r?.emailAddress?.address || r?.emailAddress?.name ? { name: r.emailAddress.name ?? "", address: r.emailAddress.address ?? "" } : null;
const recipients = (list: GraphRecipient[] | undefined) => (list ?? []).map(fromRecipient).filter((x): x is MailAddress => !!x);

export function toListItem(m: GraphMessage): MailListItem {
  return {
    id: m.id,
    subject: m.subject || "(no subject)",
    from: fromRecipient(m.from),
    to: recipients(m.toRecipients),
    preview: (m.bodyPreview ?? "").slice(0, 240),
    receivedAt: m.receivedDateTime,
    unread: !m.isRead,
    flagged: m.flag?.flagStatus === "flagged",
    hasAttachments: !!m.hasAttachments,
    important: m.importance === "high",
    draft: !!m.isDraft,
  };
}

export async function listOutlookMessages(token: string, o: ListOptions & { cursor?: string | null }): Promise<MailPage> {
  const path = o.cursor && validOutlookCursor(o.cursor) ? o.cursor : buildOutlookListPath(o);
  const res = await call<{ value: GraphMessage[]; "@odata.nextLink"?: string }>(token, "GET", path);
  let items = res.value.map(toListItem);
  if (o.search?.trim() && o.unread) items = items.filter((m) => m.unread);
  return { items, next: outlookCursor(res["@odata.nextLink"]) };
}

// ─── One message ─────────────────────────────────────────────────────────────

const MESSAGE_SELECT = "id,subject,from,toRecipients,ccRecipients,bccRecipients,replyTo,receivedDateTime,sentDateTime,isRead,isDraft,flag,importance,body,bodyPreview,hasAttachments,webLink";
const msgPath = (id: string) => `/me/messages/${encodeURIComponent(id)}`;

interface GraphAttachment {
  id: string;
  name?: string;
  contentType?: string;
  size?: number;
  isInline?: boolean;
  contentId?: string;
  contentBytes?: string;
}

const INLINE_MAX = 1024 * 1024;
const INLINE_TOTAL = 3 * 1024 * 1024;

export async function getOutlookMessage(token: string, id: string): Promise<MailMessage> {
  const m = await call<GraphMessage>(token, "GET", `${msgPath(id)}?$select=${MESSAGE_SELECT}`, undefined, { Prefer: 'outlook.body-content-type="html"' });
  let html = m.body?.contentType === "html" ? m.body.content : null;
  let attachments: MailAttachment[] = [];
  if (m.hasAttachments || (html && /cid:/i.test(html))) {
    const list = await call<{ value: GraphAttachment[] }>(token, "GET", `${msgPath(id)}/attachments?$select=id,name,contentType,size,isInline`);
    attachments = list.value.map((a) => ({ id: a.id, name: a.name || "attachment", contentType: a.contentType || "application/octet-stream", size: a.size ?? 0, inline: !!a.isInline }));
    // Inline pictures (cid:) become data: URIs, so they show without any remote request.
    if (html && /cid:/i.test(html)) {
      let budget = INLINE_TOTAL;
      const inline = attachments.filter((a) => a.inline && a.contentType.startsWith("image/") && a.size <= INLINE_MAX).slice(0, 12);
      const images: Record<string, string> = {};
      for (const a of inline) {
        if (a.size > budget) continue;
        budget -= a.size;
        const full = await call<GraphAttachment>(token, "GET", `${msgPath(id)}/attachments/${encodeURIComponent(a.id)}`).catch(() => null);
        if (full?.contentId && full.contentBytes) images[full.contentId.replace(/^<|>$/g, "")] = `data:${a.contentType};base64,${full.contentBytes}`;
      }
      html = replaceCid(html, images);
    }
  }
  return {
    ...toListItem(m),
    cc: recipients(m.ccRecipients),
    bcc: recipients(m.bccRecipients),
    replyTo: recipients(m.replyTo),
    sentAt: m.sentDateTime ?? null,
    html,
    text: html ? htmlToText(html) : (m.body?.content ?? ""),
    attachments,
    webLink: m.webLink ?? null,
  };
}

/** An attachment's bytes, streamed from Graph. */
export async function getOutlookAttachment(token: string, messageId: string, attachmentId: string): Promise<{ name: string; contentType: string; size: number; body: ReadableStream<Uint8Array> }> {
  const meta = await call<GraphAttachment>(token, "GET", `${msgPath(messageId)}/attachments/${encodeURIComponent(attachmentId)}?$select=id,name,contentType,size`);
  const res = await fetch(`${GRAPH}${msgPath(messageId)}/attachments/${encodeURIComponent(attachmentId)}/$value`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: callSignal(60_000) });
  if (!res.ok || !res.body) throw graphError(res.status, (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } });
  return { name: meta.name || "attachment", contentType: meta.contentType || "application/octet-stream", size: meta.size ?? 0, body: res.body };
}

// ─── Changes ─────────────────────────────────────────────────────────────────

export const setOutlookRead = (token: string, id: string, read: boolean) => call<void>(token, "PATCH", msgPath(id), { isRead: read });
export const setOutlookFlag = (token: string, id: string, flagged: boolean) => call<void>(token, "PATCH", msgPath(id), { flag: { flagStatus: flagged ? "flagged" : "notFlagged" } });
/** Moves a message: "archive", "deleteditems" (delete = to Deleted Items, recoverable) or a folder id. */
export const moveOutlook = (token: string, id: string, destination: string) => call<{ id: string }>(token, "POST", `${msgPath(id)}/move`, { destinationId: destination });

// ─── Sending ─────────────────────────────────────────────────────────────────

export const toRecipient = (a: MailAddress) => ({ emailAddress: a.name ? { address: a.address, name: a.name } : { address: a.address } });

export const fileAttachment = (a: OutgoingAttachment) => ({
  "@odata.type": "#microsoft.graph.fileAttachment",
  name: a.name,
  contentType: a.contentType || "application/octet-stream",
  contentBytes: Buffer.from(a.data).toString("base64"),
});

/** The new message's body: what was typed (as HTML) above the quoted thread Graph put in the draft. */
export function draftBody(draft: { body?: { contentType?: string; content?: string } } | null, typed: string): { contentType: "HTML"; content: string } {
  const mine = textToHtml(typed);
  const quoted = draft?.body?.content ?? "";
  if (!quoted.trim()) return { contentType: "HTML", content: mine };
  if (draft?.body?.contentType?.toLowerCase() === "html") return { contentType: "HTML", content: prependToHtmlBody(quoted, `${mine}<br>`) };
  return { contentType: "HTML", content: `${mine}<hr>${textToHtml(quoted)}` };
}

/** The PATCH that turns Graph's reply / forward draft into what the person wrote. */
export function draftPatch(draft: { body?: { contentType?: string; content?: string } } | null, req: SendRequest) {
  return {
    subject: req.subject,
    toRecipients: req.to.map(toRecipient),
    ccRecipients: req.cc.map(toRecipient),
    bccRecipients: req.bcc.map(toRecipient),
    body: draftBody(draft, req.body),
  };
}

/** A new message's draft. */
export const newMessagePayload = (req: SendRequest) => draftPatch(null, req);

const CREATE: Record<Exclude<SendRequest["mode"], "new">, string> = { reply: "createReply", replyAll: "createReplyAll", forward: "createForward" };

/**
 * Sends through a draft, so replies keep the thread (Graph quotes the original
 * and sets In-Reply-To) and forwards keep the original's attachments:
 * create the reply / forward / new draft → set recipients, subject and body →
 * add attachments → send. A draft left by a failure is deleted.
 */
export async function sendOutlook(token: string, req: SendRequest): Promise<void> {
  let draft: GraphMessage;
  if (req.mode === "new") draft = await call<GraphMessage>(token, "POST", "/me/messages", newMessagePayload(req));
  else {
    if (!req.messageId) throw new MailApiError(400, "No message to reply to.");
    draft = await call<GraphMessage>(token, "POST", `${msgPath(req.messageId)}/${CREATE[req.mode]}`, {});
  }
  try {
    if (req.mode !== "new") await call<void>(token, "PATCH", msgPath(draft.id), draftPatch(draft, req));
    for (const a of req.attachments) await call<void>(token, "POST", `${msgPath(draft.id)}/attachments`, fileAttachment(a));
    await call<void>(token, "POST", `${msgPath(draft.id)}/send`);
  } catch (err) {
    await call<void>(token, "DELETE", msgPath(draft.id)).catch(() => {});
    throw err;
  }
}
