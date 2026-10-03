// The mail client's shapes, shared by the server (Graph / Gmail), the pages
// and the client components. Nothing here holds a credential: the server keeps
// tokens in a MailboxHandle (src/lib/server/mail.ts) and hands components a
// MailboxRef only.

export type MailProvider = "outlook" | "gmail" | "demo";

/** One mailbox the viewer may open. */
export interface MailboxRef {
  /** URL-safe key (base64url of `id`). */
  key: string;
  /** Stable mailbox id, as in EmailMessage.mailbox: "ms:<address>", a Google account id, or "demo:<name>". */
  id: string;
  provider: MailProvider;
  /** The mailbox's address. */
  address: string;
  /** Display label (the shared connection's label, else the address). */
  label: string;
  /** Business of a shared mailbox; personal mailboxes have none. */
  business: string | null;
  /** Whose personal mailbox it is; null for a shared one. */
  owner: string | null;
}

/** What a connection's token was granted. null = not known yet (older connection, before its first refresh). */
export interface MailGrants {
  read: boolean | null;
  modify: boolean | null;
  send: boolean | null;
}

/** What the viewer may do in a mailbox (access × token grants). */
export interface MailPermissions {
  read: boolean;
  /** Mark read / unread, flag. */
  triage: boolean;
  /** Archive, delete, move. */
  organize: boolean;
  send: boolean;
  /** Why sending isn't possible, for the UI. */
  sendBlocked: string | null;
  /** The token lacks write or send: reconnect the mailbox. */
  reconnect: boolean;
}

export interface MailAddress {
  name: string;
  address: string;
}

export interface MailFolder {
  /** Provider folder / label id, or a well-known name ("inbox", "sentitems"…). */
  id: string;
  name: string;
  unread: number | null;
  total: number | null;
  wellKnown?: WellKnownFolder;
}

export type WellKnownFolder = "inbox" | "sent" | "drafts" | "archive" | "junk" | "deleted";

export interface MailListItem {
  id: string;
  subject: string;
  from: MailAddress | null;
  to: MailAddress[];
  preview: string;
  receivedAt: string;
  unread: boolean;
  flagged: boolean;
  hasAttachments: boolean;
  important: boolean;
  draft: boolean;
}

export interface MailPage {
  items: MailListItem[];
  /** Opaque cursor for the next (older) page, if any. */
  next: string | null;
}

export interface MailAttachment {
  id: string;
  name: string;
  contentType: string;
  size: number;
  inline: boolean;
}

export interface MailMessage extends MailListItem {
  cc: MailAddress[];
  bcc: MailAddress[];
  replyTo: MailAddress[];
  sentAt: string | null;
  /** The body as HTML, untrusted (only ever rendered through buildSrcdoc in a sandboxed iframe), or null when the message is plain text. */
  html: string | null;
  /** Plain-text body (always set: derived from the HTML when there's no text part). */
  text: string;
  attachments: MailAttachment[];
  /** Link to the message in Outlook on the web / Gmail. */
  webLink: string | null;
  /** Gmail: the thread to reply in. */
  threadId?: string;
  /** RFC 822 Message-ID (Gmail replies thread on it). */
  messageIdHeader?: string | null;
  references?: string | null;
}

export type ComposeMode = "new" | "reply" | "replyAll" | "forward";

export interface OutgoingAttachment {
  name: string;
  contentType: string;
  /** Raw bytes. */
  data: Uint8Array;
}

export interface SendRequest {
  mode: ComposeMode;
  /** The message replied to / forwarded (not for "new"). */
  messageId?: string;
  to: MailAddress[];
  cc: MailAddress[];
  bcc: MailAddress[];
  subject: string;
  /** What the person typed (plain text). */
  body: string;
  attachments: OutgoingAttachment[];
}
