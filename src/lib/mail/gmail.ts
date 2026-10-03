import { randomBytes } from "node:crypto";
import { callSignal } from "../source";
import { escapeHtml, htmlToText, replaceCid, textToHtml } from "./html";
import { PAGE_SIZE } from "./limits";
import { formatAddressList } from "./access";
import { MailApiError } from "./outlook";
import type { MailAddress, MailAttachment, MailFolder, MailListItem, MailMessage, MailPage, OutgoingAttachment, SendRequest, WellKnownFolder } from "./types";

// Gmail through the Gmail API, fetched live per request like Outlook.
// Folders are labels; "Archive" is everything outside the Inbox, Sent, Drafts,
// Spam and Trash. Sending builds an RFC 822 message (threaded with
// In-Reply-To / References) and hands it to users.messages.send.

const API = "https://gmail.googleapis.com/gmail/v1/users/me";

function gmailError(status: number, body: { error?: { message?: string } }) {
  if (status === 403) return new MailApiError(status, "Google refused: this mailbox's connection doesn't allow that. Reconnect it to grant read/write and send.");
  if (status === 404) return new MailApiError(status, "That message or label no longer exists.");
  if (status === 429) return new MailApiError(status, "Google is rate-limiting this mailbox. Try again in a minute.");
  return new MailApiError(status, `${status} from Gmail: ${body.error?.message ?? "request failed"}`);
}

async function call<T>(token: string, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    cache: "no-store",
    signal: callSignal(20_000),
  });
  if (!res.ok) throw gmailError(res.status, (await res.json().catch(() => ({}))) as { error?: { message?: string } });
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

// ─── Folders (labels) ────────────────────────────────────────────────────────

export const GMAIL_FOLDERS: Record<WellKnownFolder, string> = { inbox: "INBOX", sent: "SENT", drafts: "DRAFT", archive: "archive", junk: "SPAM", deleted: "TRASH" };
const LABEL_NAME: Record<WellKnownFolder, string> = { inbox: "Inbox", sent: "Sent", drafts: "Drafts", archive: "Archive", junk: "Spam", deleted: "Trash" };
const ARCHIVE_QUERY = "-in:inbox -in:sent -in:drafts -in:spam -in:trash";
export const validLabel = (l: string) => /^[A-Za-z0-9_\-]{1,128}$/.test(l);

export async function listGmailFolders(token: string): Promise<MailFolder[]> {
  const res = await call<{ labels?: { id: string; name: string; type: string }[] }>(token, "GET", "/labels");
  const inbox = await call<{ messagesUnread?: number; messagesTotal?: number }>(token, "GET", "/labels/INBOX").catch(() => null);
  const known = (Object.keys(GMAIL_FOLDERS) as WellKnownFolder[]).map((k): MailFolder => ({
    id: GMAIL_FOLDERS[k],
    name: LABEL_NAME[k],
    unread: k === "inbox" ? (inbox?.messagesUnread ?? null) : null,
    total: k === "inbox" ? (inbox?.messagesTotal ?? null) : null,
    wellKnown: k,
  }));
  const user = (res.labels ?? []).filter((l) => l.type === "user" && validLabel(l.id)).map((l): MailFolder => ({ id: l.id, name: l.name, unread: null, total: null }));
  return [...known, ...user.sort((a, b) => a.name.localeCompare(b.name))];
}

// ─── Listing ─────────────────────────────────────────────────────────────────

/** A search, made safe for Gmail's query box (no operators smuggled in through quotes). */
const gmailPhrase = (q: string) => q.replace(/["\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);

export function buildGmailListPath(o: { folder: string; search?: string | null; unread?: boolean; top?: number; cursor?: string | null }): string {
  if (o.folder !== "archive" && !validLabel(o.folder)) throw new MailApiError(400, "Unknown folder.");
  const q = new URLSearchParams({ maxResults: String(Math.max(1, Math.min(100, o.top ?? PAGE_SIZE))) });
  const terms: string[] = [];
  if (o.folder === "archive") terms.push(ARCHIVE_QUERY);
  else q.set("labelIds", o.folder);
  if (o.folder === "SPAM" || o.folder === "TRASH") q.set("includeSpamTrash", "true");
  if (o.unread) terms.push("is:unread");
  const s = o.search ? gmailPhrase(o.search) : "";
  if (s) terms.push(s);
  if (terms.length) q.set("q", terms.join(" "));
  if (o.cursor && /^[A-Za-z0-9_\-]{1,512}$/.test(o.cursor)) q.set("pageToken", o.cursor);
  return `/messages?${q}`;
}

interface GmailPart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: GmailPart[];
}

interface GmailMsg {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailPart;
}

const header = (p: GmailPart | undefined, name: string) => p?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";

/** "Name <a@b>, c@d" → addresses (as Gmail returns them in headers). */
export function parseHeaderAddresses(v: string): MailAddress[] {
  if (!v.trim()) return [];
  const out: MailAddress[] = [];
  for (const raw of v.match(/(?:"[^"]*"|[^,])+/g) ?? []) {
    const p = raw.trim();
    const m = p.match(/^(.*?)\s*<([^<>]+)>$/);
    const address = (m ? m[2] : p).trim();
    const name = m ? m[1].trim().replace(/^"(.*)"$/, "$1") : "";
    if (address || name) out.push({ name, address });
  }
  return out;
}

function walk(p: GmailPart | undefined, fn: (p: GmailPart) => void) {
  if (!p) return;
  fn(p);
  for (const c of p.parts ?? []) walk(c, fn);
}

const isAttachment = (p: GmailPart) => !!p.filename && !!(p.body?.attachmentId || p.body?.data);

export function toGmailListItem(m: GmailMsg): MailListItem {
  const labels = m.labelIds ?? [];
  const from = parseHeaderAddresses(header(m.payload, "From"))[0] ?? null;
  let hasAttachments = false;
  walk(m.payload, (p) => {
    if (isAttachment(p) || /^multipart\/mixed/i.test(p.mimeType ?? "")) hasAttachments = true;
  });
  return {
    id: m.id,
    subject: header(m.payload, "Subject") || "(no subject)",
    from,
    to: parseHeaderAddresses(header(m.payload, "To")),
    preview: decodeSnippet(m.snippet ?? "").slice(0, 240),
    receivedAt: new Date(Number(m.internalDate ?? Date.now())).toISOString(),
    unread: labels.includes("UNREAD"),
    flagged: labels.includes("STARRED"),
    hasAttachments,
    important: labels.includes("IMPORTANT"),
    draft: labels.includes("DRAFT"),
  };
}

const decodeSnippet = (s: string) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

export async function listGmailMessages(token: string, o: { folder: string; search?: string | null; unread?: boolean; cursor?: string | null }): Promise<MailPage> {
  const res = await call<{ messages?: { id: string }[]; nextPageToken?: string }>(token, "GET", buildGmailListPath(o));
  const meta = "format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Content-Type";
  const items = await Promise.all((res.messages ?? []).map((x) => call<GmailMsg>(token, "GET", `/messages/${encodeURIComponent(x.id)}?${meta}`).then(toGmailListItem)));
  return { items, next: res.nextPageToken ?? null };
}

export const gmailWebLink = (threadId: string, address?: string) =>
  `https://mail.google.com/mail/u/${address ? `?authuser=${encodeURIComponent(address)}` : "0/"}#all/${encodeURIComponent(threadId)}`;

// ─── One message ─────────────────────────────────────────────────────────────

const b64url = (s: string) => Buffer.from(s, "base64url");
const validId = (id: string) => /^[A-Za-z0-9_\-]{1,256}$/.test(id);
const msgPath = (id: string) => {
  if (!validId(id)) throw new MailApiError(400, "Unknown message.");
  return `/messages/${id}`;
};

async function partData(token: string, messageId: string, p: GmailPart): Promise<Buffer> {
  if (p.body?.data) return b64url(p.body.data);
  if (p.body?.attachmentId) return b64url((await call<{ data: string }>(token, "GET", `${msgPath(messageId)}/attachments/${encodeURIComponent(p.body.attachmentId)}`)).data);
  return Buffer.alloc(0);
}

const charsetOf = (p: GmailPart) => /charset="?([\w-]+)/i.exec(header(p, "Content-Type"))?.[1]?.toLowerCase() ?? "utf-8";
function decodeText(buf: Buffer, charset: string) {
  try {
    return new TextDecoder(charset).decode(buf);
  } catch {
    return buf.toString("utf8");
  }
}

/** `address` picks the right account in the "Open in Gmail" link when several are signed in. */
export async function getGmailMessage(token: string, id: string, address?: string): Promise<MailMessage> {
  const m = await call<GmailMsg>(token, "GET", `${msgPath(id)}?format=full`);
  let htmlPart: GmailPart | null = null;
  let textPart: GmailPart | null = null;
  const attachments: MailAttachment[] = [];
  const inline: { cid: string; part: GmailPart }[] = [];
  walk(m.payload, (p) => {
    const cid = header(p, "Content-ID").replace(/^<|>$/g, "");
    if (isAttachment(p)) {
      const isInline = !!cid && /^inline/i.test(header(p, "Content-Disposition") || "inline");
      attachments.push({ id: p.partId ?? "", name: p.filename || "attachment", contentType: p.mimeType || "application/octet-stream", size: p.body?.size ?? 0, inline: isInline });
      if (cid && (p.mimeType ?? "").startsWith("image/")) inline.push({ cid, part: p });
    } else if (p.mimeType === "text/html" && !htmlPart) htmlPart = p;
    else if (p.mimeType === "text/plain" && !textPart) textPart = p;
    else if (cid && (p.mimeType ?? "").startsWith("image/")) inline.push({ cid, part: p });
  });
  const hp = htmlPart as GmailPart | null;
  const tp = textPart as GmailPart | null;
  let html = hp ? decodeText(await partData(token, id, hp), charsetOf(hp)) : null;
  if (html && /cid:/i.test(html)) {
    const images: Record<string, string> = {};
    let budget = 3 * 1024 * 1024;
    for (const { cid, part } of inline.slice(0, 12)) {
      if ((part.body?.size ?? 0) > Math.min(budget, 1024 * 1024)) continue;
      budget -= part.body?.size ?? 0;
      const data = await partData(token, id, part).catch(() => null);
      if (data) images[cid] = `data:${part.mimeType};base64,${data.toString("base64")}`;
    }
    html = replaceCid(html, images);
  }
  const text = tp ? decodeText(await partData(token, id, tp), charsetOf(tp)) : html ? htmlToText(html) : "";
  const p = m.payload;
  return {
    ...toGmailListItem(m),
    cc: parseHeaderAddresses(header(p, "Cc")),
    bcc: parseHeaderAddresses(header(p, "Bcc")),
    replyTo: parseHeaderAddresses(header(p, "Reply-To")),
    sentAt: header(p, "Date") ? new Date(header(p, "Date")).toISOString() : null,
    html,
    text,
    attachments: attachments.filter((a) => a.id),
    webLink: gmailWebLink(m.threadId, address),
    threadId: m.threadId,
    messageIdHeader: header(p, "Message-ID") || header(p, "Message-Id") || null,
    references: header(p, "References") || null,
  };
}

/** An attachment by its part id (Gmail's attachment ids change on every read, part ids don't). */
export async function getGmailAttachment(token: string, messageId: string, partId: string): Promise<{ name: string; contentType: string; size: number; body: ReadableStream<Uint8Array> }> {
  if (!/^[0-9.]{1,32}$/.test(partId)) throw new MailApiError(400, "Unknown attachment.");
  const m = await call<GmailMsg>(token, "GET", `${msgPath(messageId)}?format=full`);
  let found: GmailPart | null = null;
  walk(m.payload, (p) => {
    if (p.partId === partId && isAttachment(p)) found = p;
  });
  const part = found as GmailPart | null;
  if (!part) throw new MailApiError(404, "That attachment no longer exists.");
  const data = await partData(token, messageId, part);
  return { name: part.filename || "attachment", contentType: part.mimeType || "application/octet-stream", size: data.length, body: new Blob([new Uint8Array(data)]).stream() };
}

// ─── Changes ─────────────────────────────────────────────────────────────────

export const modifyGmail = (token: string, id: string, add: string[], remove: string[]) => call<void>(token, "POST", `${msgPath(id)}/modify`, { addLabelIds: add, removeLabelIds: remove });
export const setGmailRead = (token: string, id: string, read: boolean) => (read ? modifyGmail(token, id, [], ["UNREAD"]) : modifyGmail(token, id, ["UNREAD"], []));
export const setGmailFlag = (token: string, id: string, flagged: boolean) => (flagged ? modifyGmail(token, id, ["STARRED"], []) : modifyGmail(token, id, [], ["STARRED"]));
export const archiveGmail = (token: string, id: string) => modifyGmail(token, id, [], ["INBOX"]);
/** Delete = Trash (recoverable for 30 days). */
export const trashGmail = (token: string, id: string) => call<void>(token, "POST", `${msgPath(id)}/trash`);

// ─── Sending ─────────────────────────────────────────────────────────────────

/** No line breaks in a header value (header injection), trimmed. */
const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ").trim();
/** RFC 2047: non-ASCII header text as UTF-8 base64. */
export const encodeWord = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`);
const addressHeader = (list: MailAddress[]) =>
  list.map((a) => (a.name ? `${/^[\x20-\x7e]*$/.test(a.name) ? `"${oneLine(a.name).replace(/["\\]/g, "")}"` : encodeWord(oneLine(a.name))} <${oneLine(a.address)}>` : oneLine(a.address))).join(", ");
const wrap76 = (b64: string) => b64.replace(/.{1,76}/g, "$&\r\n").trimEnd();

/** The quoted original under a reply / forward. */
export function quoteOriginal(mode: SendRequest["mode"], orig: MailMessage): { html: string; text: string } {
  const when = new Date(orig.sentAt ?? orig.receivedAt).toUTCString();
  const who = orig.from ? formatAddressList([orig.from]) : "";
  const origHtml = orig.html ?? textToHtml(orig.text);
  if (mode === "forward") {
    const head = [`From: ${who}`, `Date: ${when}`, `Subject: ${orig.subject}`, `To: ${formatAddressList(orig.to)}`, ...(orig.cc.length ? [`Cc: ${formatAddressList(orig.cc)}`] : [])];
    return {
      html: `<br><div>---------- Forwarded message ---------<br>${head.map(escapeHtml).join("<br>")}</div><br>${origHtml}`,
      text: `\n\n---------- Forwarded message ---------\n${head.join("\n")}\n\n${orig.text}`,
    };
  }
  return {
    html: `<br><div>On ${escapeHtml(when)}, ${escapeHtml(who)} wrote:</div><blockquote style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">${origHtml}</blockquote>`,
    text: `\n\nOn ${when}, ${who} wrote:\n${orig.text.split("\n").map((l) => `> ${l}`).join("\n")}`,
  };
}

/** The raw RFC 822 message for users.messages.send. `boundary` is fixed in tests. */
export function buildMime(o: { from: string; req: SendRequest; original?: MailMessage | null; extraAttachments?: OutgoingAttachment[]; boundary?: string; date?: Date }): string {
  const { req, original } = o;
  const b = o.boundary ?? `kcc_${randomBytes(12).toString("hex")}`;
  const quoted = original && req.mode !== "new" ? quoteOriginal(req.mode, original) : { html: "", text: "" };
  const html = `${textToHtml(req.body)}${quoted.html}`;
  const text = `${req.body}${quoted.text}`;
  const lines = [
    `From: ${oneLine(o.from)}`,
    ...(req.to.length ? [`To: ${addressHeader(req.to)}`] : []),
    ...(req.cc.length ? [`Cc: ${addressHeader(req.cc)}`] : []),
    ...(req.bcc.length ? [`Bcc: ${addressHeader(req.bcc)}`] : []),
    `Subject: ${encodeWord(oneLine(req.subject))}`,
    `Date: ${(o.date ?? new Date()).toUTCString()}`,
    "MIME-Version: 1.0",
  ];
  if (original?.messageIdHeader && (req.mode === "reply" || req.mode === "replyAll")) {
    lines.push(`In-Reply-To: ${oneLine(original.messageIdHeader)}`);
    lines.push(`References: ${oneLine([original.references, original.messageIdHeader].filter(Boolean).join(" "))}`);
  }
  lines.push(`Content-Type: multipart/mixed; boundary="${b}"`, "");
  const alt = `${b}_alt`;
  lines.push(
    `--${b}`,
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    "",
    `--${alt}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(Buffer.from(text, "utf8").toString("base64")),
    `--${alt}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(Buffer.from(html, "utf8").toString("base64")),
    `--${alt}--`,
  );
  for (const a of [...(o.extraAttachments ?? []), ...req.attachments]) {
    const name = oneLine(a.name).replace(/["\\]/g, "_") || "attachment";
    lines.push(
      `--${b}`,
      `Content-Type: ${/^[\w.+-]+\/[\w.+-]+$/.test(a.contentType) ? a.contentType : "application/octet-stream"}; name="${encodeWord(name)}"`,
      `Content-Disposition: attachment; filename="${encodeWord(name)}"`,
      "Content-Transfer-Encoding: base64",
      "",
      wrap76(Buffer.from(a.data).toString("base64")),
    );
  }
  lines.push(`--${b}--`, "");
  return lines.join("\r\n");
}

/** users.messages.send: the raw message, in the original's thread for replies and forwards. */
export function gmailSendPayload(raw: string, original?: MailMessage | null) {
  return { raw: Buffer.from(raw, "utf8").toString("base64url"), ...(original?.threadId ? { threadId: original.threadId } : {}) };
}

export async function sendGmail(token: string, from: string, req: SendRequest, opts: { attachmentBudget: number }): Promise<void> {
  let original: MailMessage | null = null;
  const extra: OutgoingAttachment[] = [];
  if (req.mode !== "new") {
    if (!req.messageId) throw new MailApiError(400, "No message to reply to.");
    original = await getGmailMessage(token, req.messageId);
    // A forward carries the original's attachments, as Gmail's own does.
    if (req.mode === "forward") {
      let budget = opts.attachmentBudget;
      for (const a of original.attachments.filter((x) => !x.inline)) {
        if (a.size > budget) throw new MailApiError(413, "The original's attachments are too large to forward from here. Forward it from Gmail instead.");
        const file = await getGmailAttachment(token, req.messageId, a.id);
        const data = new Uint8Array(await new Response(file.body).arrayBuffer());
        budget -= data.length;
        extra.push({ name: file.name, contentType: file.contentType, data });
      }
    }
  }
  await call<void>(token, "POST", "/messages/send", gmailSendPayload(buildMime({ from, req, original, extraAttachments: extra }), original));
}
