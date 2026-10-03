import type { Access } from "../access";
import { errorMessage, samplesEnabled } from "../source";
import { canReadMailbox, fromKey, mailGrants, mailPermissions, toKey } from "../mail/access";
import { demoAttachment, demoFolders, demoList, demoMessage, demoSend, demoUpdate, DEMO_MAILBOX } from "../mail/demo";
import { archiveGmail, getGmailAttachment, getGmailMessage, GMAIL_FOLDERS, listGmailFolders, listGmailMessages, sendGmail, setGmailFlag, setGmailRead, trashGmail, validLabel } from "../mail/gmail";
import { MAX_TOTAL_ATTACHMENT_BYTES, SENDS_PER_HOUR } from "../mail/limits";
import { getOutlookAttachment, getOutlookMessage, listOutlookFolders, listOutlookMessages, MailApiError, moveOutlook, OUTLOOK_FOLDERS, sendOutlook, setOutlookFlag, setOutlookRead, validFolder } from "../mail/outlook";
import type { MailboxRef, MailFolder, MailGrants, MailMessage, MailPage, MailPermissions, SendRequest, WellKnownFolder } from "../mail/types";
import { formatAddressList } from "../mail/access";
import { googleClient, gmailAccounts, microsoftAccounts, personalAccounts, type GoogleAccount, type MicrosoftAccount } from "./credentials";
import { isProduction } from "./db";
import { googleAccessToken, hasGoogleScope } from "./google";
import { msToken } from "./microsoft";
import { audit } from "./store/audit";
import { takeAttempt } from "./store/ratelimit";

// The live mail client's server side. Every entry point takes the signed-in
// person and a mailbox key and checks, on that call, that the person may use
// the mailbox for what they ask (src/lib/mail/access.ts) before a token is
// fetched. Nothing here goes through the shared dashboard cache: messages are
// read from Graph / Gmail per request and never stored.

export type MailUser = Access & { email: string };

type Cred = { kind: "outlook"; account: MicrosoftAccount } | { kind: "gmail"; account: GoogleAccount } | { kind: "demo" };

export interface MailboxHandle extends MailboxRef {
  /** Scopes recorded on the connection (null when unknown). */
  scopes: string[] | null;
  cred: Cred;
}

/** The sample mailbox: development only, with sample data on and nothing real connected. */
export const demoMailAllowed = () => samplesEnabled() && !isProduction();

const outlookHandle = (a: MicrosoftAccount): MailboxHandle => {
  const id = `ms:${a.account}`;
  return { key: toKey(id), id, provider: "outlook", address: a.account, label: a.owner ? a.account : a.label, business: a.owner ? null : a.business, owner: a.owner ?? null, scopes: a.scopes ?? null, cred: { kind: "outlook", account: a } };
};

const gmailHandle = (a: GoogleAccount): MailboxHandle => ({
  key: toKey(a.id),
  id: a.id,
  provider: "gmail",
  address: a.email ?? a.label,
  label: a.owner ? (a.email ?? a.label) : a.label,
  business: a.owner ? null : a.business,
  owner: a.owner ?? null,
  scopes: a.scopes,
  cred: { kind: "gmail", account: a },
});

const demoHandle = (): MailboxHandle => ({ key: toKey(DEMO_MAILBOX.id), id: DEMO_MAILBOX.id, provider: "demo", address: DEMO_MAILBOX.address, label: DEMO_MAILBOX.label, business: DEMO_MAILBOX.business, owner: null, scopes: null, cred: { kind: "demo" } });

/** Every connected mailbox: shared ones first, then personal ones. */
async function allMailboxes(): Promise<MailboxHandle[]> {
  const google = !!googleClient();
  const [shared, personal, gmail] = await Promise.all([microsoftAccounts(), personalAccounts(), google ? gmailAccounts() : Promise.resolve([])]);
  const list = [
    ...shared.map(outlookHandle),
    // GMAIL_ACCOUNTS entries (env:…) have no address to send from; they stay in the summary list only.
    ...gmail.filter((a) => !a.id.startsWith("env:")).map(gmailHandle),
    ...personal.microsoft.map(outlookHandle),
    ...(google ? personal.google.filter((a) => hasGoogleScope(a.scopes, "gmail") !== false).map(gmailHandle) : []),
  ];
  return list.length === 0 && demoMailAllowed() ? [demoHandle()] : list;
}

/** The mailboxes this person may open (never anyone else's personal one; shared ones by role and business). */
export async function mailboxesFor(user: MailUser): Promise<MailboxHandle[]> {
  return (await allMailboxes()).filter((m) => canReadMailbox(user, user.email, m));
}

/** What a client component may see of a mailbox (no credential). */
export const publicRef = (h: MailboxHandle): MailboxRef => ({ key: h.key, id: h.id, provider: h.provider, address: h.address, label: h.label, business: h.business, owner: h.owner });

export class MailAccessError extends Error {}

export type MailNeed = "read" | "triage" | "organize" | "send";

export interface OpenMailbox {
  h: MailboxHandle;
  token: string;
  grants: MailGrants;
  perms: MailPermissions;
}

async function tokenFor(h: MailboxHandle): Promise<{ token: string; scopes: string[] | null }> {
  if (h.cred.kind === "demo") return { token: "demo", scopes: null };
  if (h.cred.kind === "outlook") {
    const t = await msToken(h.cred.account);
    return { token: t.token, scopes: t.scopes ?? h.scopes };
  }
  return { token: await googleAccessToken(h.cred.account.refreshToken), scopes: h.scopes };
}

/**
 * The access check every mail call goes through: the mailbox must be one the
 * person may read, and allow what's asked. An unknown key and a mailbox the
 * person may not open get the same answer.
 */
export async function openMailbox(user: MailUser, key: string, need: MailNeed): Promise<OpenMailbox> {
  const id = fromKey(key);
  const h = id ? (await mailboxesFor(user)).find((m) => m.id === id) : undefined;
  if (!h) throw new MailAccessError("That mailbox isn't available to you.");
  const t = await tokenFor(h);
  const grants = mailGrants(h.provider, t.scopes);
  const perms = mailPermissions(user, user.email, h, grants);
  const allowed = { read: perms.read, triage: perms.triage, organize: perms.organize, send: perms.send }[need];
  if (!allowed) throw new MailAccessError(need === "send" ? (perms.sendBlocked ?? "You can't send from this mailbox.") : need === "organize" ? "Only the dashboard owner archives or deletes in the mailboxes connected on Platforms." : "You can't change messages in this mailbox.");
  return { h, token: t.token, grants, perms };
}

// ─── Folders ─────────────────────────────────────────────────────────────────

/** A provider's id for a well-known folder. */
export function wellKnownId(provider: MailboxRef["provider"], f: WellKnownFolder): string {
  return provider === "gmail" ? GMAIL_FOLDERS[f] : OUTLOOK_FOLDERS[f];
}

export const defaultFolder = (provider: MailboxRef["provider"]) => wellKnownId(provider, "inbox");

/** Whether a folder id from the URL is well-formed for this provider. */
export const validFolderId = (provider: MailboxRef["provider"], f: string) => (provider === "gmail" ? f === "archive" || validLabel(f) : validFolder(f));

export async function listFolders(o: OpenMailbox): Promise<MailFolder[]> {
  if (o.h.cred.kind === "demo") return demoFolders();
  return o.h.cred.kind === "outlook" ? listOutlookFolders(o.token) : listGmailFolders(o.token);
}

export async function listMessages(o: OpenMailbox, q: { folder: string; search?: string | null; unread?: boolean; cursor?: string | null }): Promise<MailPage> {
  if (!validFolderId(o.h.provider, q.folder)) throw new MailApiError(400, "Unknown folder.");
  if (o.h.cred.kind === "demo") return demoList(q);
  return o.h.cred.kind === "outlook" ? listOutlookMessages(o.token, q) : listGmailMessages(o.token, q);
}

export async function getMessage(o: OpenMailbox, id: string): Promise<MailMessage> {
  if (o.h.cred.kind === "demo") {
    const m = demoMessage(id);
    if (!m) throw new MailApiError(404, "That message no longer exists.");
    return m;
  }
  return o.h.cred.kind === "outlook" ? getOutlookMessage(o.token, id) : getGmailMessage(o.token, id, o.h.address);
}

export async function getAttachment(o: OpenMailbox, messageId: string, attachmentId: string) {
  if (o.h.cred.kind === "demo") {
    const a = demoAttachment(messageId, attachmentId);
    if (!a) throw new MailApiError(404, "That attachment no longer exists.");
    return a;
  }
  return o.h.cred.kind === "outlook" ? getOutlookAttachment(o.token, messageId, attachmentId) : getGmailAttachment(o.token, messageId, attachmentId);
}

// ─── Changes ─────────────────────────────────────────────────────────────────

export type MailChange = { kind: "read"; read: boolean } | { kind: "flag"; flagged: boolean } | { kind: "archive" } | { kind: "delete" };

/** Applies a change; `o` must have been opened for "triage" (read, flag) or "organize" (archive, delete). */
export async function changeMessage(o: OpenMailbox, id: string, c: MailChange): Promise<void> {
  if ((c.kind === "archive" || c.kind === "delete") && !o.perms.organize) throw new MailAccessError("Only the dashboard owner archives or deletes in the mailboxes connected on Platforms.");
  if (!o.perms.triage) throw new MailAccessError("You can't change messages in this mailbox.");
  const { cred } = o.h;
  if (cred.kind === "demo") {
    demoUpdate(id, c.kind === "read" ? { read: c.read } : c.kind === "flag" ? { flagged: c.flagged } : { folder: c.kind === "archive" ? "archive" : "deleteditems" });
    return;
  }
  if (cred.kind === "outlook") {
    if (c.kind === "read") return setOutlookRead(o.token, id, c.read);
    if (c.kind === "flag") return setOutlookFlag(o.token, id, c.flagged);
    await moveOutlook(o.token, id, c.kind === "archive" ? "archive" : "deleteditems");
    return;
  }
  if (c.kind === "read") return setGmailRead(o.token, id, c.read);
  if (c.kind === "flag") return setGmailFlag(o.token, id, c.flagged);
  return c.kind === "archive" ? archiveGmail(o.token, id) : trashGmail(o.token, id);
}

// ─── Sending ─────────────────────────────────────────────────────────────────

export type SendResult = { ok: true; demo?: boolean } | { ok: false; error: string };

/**
 * Sends from a mailbox the person may send from (their own, or a shared one
 * when they're a full owner). Rate-limited, and every attempt is audited:
 * who, from which mailbox, to whom and the subject, never the body.
 */
export async function sendMail(user: MailUser, key: string, req: SendRequest, ip: string | null = null): Promise<SendResult> {
  let o: OpenMailbox;
  try {
    o = await openMailbox(user, key, "send");
  } catch (err) {
    return { ok: false, error: err instanceof MailAccessError ? err.message : `Couldn't open the mailbox (${errorMessage(err)}).` };
  }
  if ((await takeAttempt(`mail-send:${user.email}`, 3600).catch(() => 0)) > SENDS_PER_HOUR) return { ok: false, error: `You've sent ${SENDS_PER_HOUR} messages from here this hour. Try again later.` };
  const { target, detail } = sendAuditEntry(o.h, req);
  try {
    if (o.h.cred.kind === "demo") demoSend(req);
    else if (o.h.cred.kind === "outlook") await sendOutlook(o.token, req);
    else await sendGmail(o.token, o.h.address, req, { attachmentBudget: MAX_TOTAL_ATTACHMENT_BYTES - req.attachments.reduce((n, a) => n + a.data.length, 0) });
  } catch (err) {
    const error = errorMessage(err);
    await audit(user.email, "mail.send_failed", target, { ...detail, ...(o.h.owner ? {} : { error: error.slice(0, 300) }) }, ip).catch(() => {});
    return { ok: false, error };
  }
  await audit(user.email, "mail.send", target, detail, ip).catch((err) => console.error(`[mail] audit failed: ${errorMessage(err)}`));
  return o.h.cred.kind === "demo" ? { ok: true, demo: true } : { ok: true };
}

/** What the audit log keeps of a mailbox: a shared one by address; a personal one never named (owners read the log). */
export const auditTarget = (h: Pick<MailboxRef, "owner" | "address">) => (h.owner ? "personal mailbox" : h.address);

/**
 * A send's audit entry. Shared mailboxes: mailbox, recipients and subject.
 * Personal mailboxes: only the kind of message and how many recipients and
 * attachments, since the log is readable by the dashboard's owners.
 */
export function sendAuditEntry(h: Pick<MailboxRef, "owner" | "address">, req: SendRequest) {
  const counts = { mode: req.mode, recipients: req.to.length + req.cc.length + req.bcc.length, attachments: req.attachments.length };
  if (h.owner) return { target: auditTarget(h), detail: counts };
  return {
    target: auditTarget(h),
    detail: { mailbox: h.address, ...counts, to: req.to.map((a) => a.address), cc: req.cc.map((a) => a.address), bcc: req.bcc.map((a) => a.address), subject: req.subject.slice(0, 200) },
  };
}

/** The summary list's id for a message ("<mailbox>:<provider id>") → its in-app link, when the mailbox is a real one. */
export function messageHref(e: { id: string; mailbox: string }): string | null {
  if (e.mailbox.startsWith("demo:") || e.mailbox.startsWith("env:") || !e.id.startsWith(`${e.mailbox}:`)) return null;
  return `/inbox/m/${toKey(e.mailbox)}/${toKey(e.id.slice(e.mailbox.length + 1))}`;
}

/** "Re: " / "Fw: " once. */
export function replySubject(mode: SendRequest["mode"], subject: string) {
  if (mode === "new") return subject;
  const s = subject === "(no subject)" ? "" : subject;
  if (mode === "forward") return /^(fw|fwd):/i.test(s) ? s : `Fw: ${s}`;
  return /^re:/i.test(s) ? s : `Re: ${s}`;
}

/** Who a reply goes to by default: the sender (or Reply-To); reply all adds everyone else but the mailbox itself. */
export function replyRecipients(mode: SendRequest["mode"], m: Pick<MailMessage, "from" | "to" | "cc" | "replyTo">, self: string) {
  if (mode === "new" || mode === "forward") return { to: "", cc: "" };
  const me = self.toLowerCase();
  const seen = new Set<string>([me]);
  const take = (list: { name: string; address: string }[]) =>
    list.filter((a) => {
      const k = a.address.toLowerCase();
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  let primary = take(m.replyTo.length ? m.replyTo : m.from ? [m.from] : []);
  // Replying to one's own message (from Sent) goes to its recipients.
  if (!primary.length) primary = take(m.to);
  if (mode === "reply") return { to: formatAddressList(primary), cc: "" };
  const to = [...primary, ...take(m.to)];
  return { to: formatAddressList(to), cc: formatAddressList(take(m.cc)) };
}
