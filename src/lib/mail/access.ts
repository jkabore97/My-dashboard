import { canSee, inBusiness, isFullOwner, type Access } from "../access";
import type { MailAddress, MailboxRef, MailGrants, MailPermissions, MailProvider } from "./types";

// Who may do what in a mailbox. Pure, so the pages, the actions, the
// attachment and send routes and the tests share one definition.
//
// - A personal mailbox is its owner's alone: they read, organise and send
//   from it (while their access includes the Inbox). Nobody else, full owners
//   included, ever opens it.
// - A mailbox connected on Platforms is the owner's mail: only full owners
//   open it (members never see it, whatever their sections or businesses).

export function canReadMailbox(a: Access, email: string, mb: Pick<MailboxRef, "owner" | "business">): boolean {
  if (!canSee(a, "inbox")) return false;
  if (mb.owner) return mb.owner === email;
  // Mailboxes connected on Platforms are the owner's mail: full owners only.
  return isFullOwner(a) && inBusiness(a, mb.business);
}

export function canSendFrom(a: Access, email: string, mb: Pick<MailboxRef, "owner" | "business">): boolean {
  if (!canReadMailbox(a, email, mb)) return false;
  return mb.owner ? mb.owner === email : isFullOwner(a);
}

/** Microsoft scope names as granted ("https://graph.microsoft.com/Mail.Send" or "Mail.Send"), lower-cased. */
export const normalizeMsScopes = (scopes: string[]) => scopes.map((s) => s.replace(/^https:\/\/graph\.microsoft\.com\//i, "").toLowerCase());

/** Parses a token response's space-separated `scope` into a list (null when missing). */
export const scopeList = (scope: string | undefined | null): string[] | null => (scope ? scope.split(/\s+/).filter(Boolean) : null);

const GMAIL = "https://www.googleapis.com/auth/";

/** What a mailbox connection's token allows, from its granted scopes. */
export function mailGrants(provider: MailProvider, scopes: string[] | null): MailGrants {
  if (provider === "demo") return { read: true, modify: true, send: true };
  if (!scopes) return { read: null, modify: null, send: null };
  if (provider === "outlook") {
    const s = new Set(normalizeMsScopes(scopes));
    const modify = s.has("mail.readwrite");
    return { read: modify || s.has("mail.read"), modify, send: s.has("mail.send") };
  }
  const s = new Set(scopes);
  const full = s.has("https://mail.google.com/");
  const modify = full || s.has(`${GMAIL}gmail.modify`);
  return {
    read: modify || s.has(`${GMAIL}gmail.readonly`),
    modify,
    send: full || s.has(`${GMAIL}gmail.send`) || s.has(`${GMAIL}gmail.compose`),
  };
}

/** The token is known to lack write or send access: the mailbox has to be connected again. */
export const needsReconnect = (g: MailGrants) => g.modify === false || g.send === false;

/** The viewer's permissions in one mailbox. Unknown grants (null) are tried; Microsoft / Google answer if they're missing. */
export function mailPermissions(a: Access, email: string, mb: Pick<MailboxRef, "owner" | "business">, g: MailGrants): MailPermissions {
  const read = canReadMailbox(a, email, mb) && g.read !== false;
  const sender = canSendFrom(a, email, mb);
  const reconnect = needsReconnect(g);
  const sendBlocked = !read
    ? "You can't open this mailbox."
    : !sender
      ? "Only the dashboard owner sends from the mailboxes connected on Platforms."
      : g.send === false
        ? "This mailbox was connected without permission to send. Reconnect it to enable replying."
        : null;
  return {
    read,
    triage: read && g.modify !== false,
    organize: read && sender && g.modify !== false,
    send: read && sender && g.send !== false,
    sendBlocked,
    reconnect,
  };
}

// ─── Addresses ───────────────────────────────────────────────────────────────

const ADDRESS = /^[^\s@<>(),;:"[\]]{1,64}@[^\s@<>(),;:"[\]]{1,190}\.[^\s@<>(),;:"[\]]{1,63}$/;

export const validAddress = (s: string) => ADDRESS.test(s);

/**
 * Parses what someone typed in a To / Cc / Bcc box: addresses separated by
 * commas, semicolons or new lines, each "a@b.com" or "Name <a@b.com>".
 * Returns the list, or the first entry that isn't an address.
 */
export function parseAddressList(input: string): { list: MailAddress[] } | { error: string } {
  const out: MailAddress[] = [];
  const seen = new Set<string>();
  // Split on separators that aren't inside quotes.
  const parts: string[] = [];
  let cur = "";
  let quoted = false;
  for (const ch of input) {
    if (ch === '"') quoted = !quoted;
    if (!quoted && (ch === "," || ch === ";" || ch === "\n")) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  parts.push(cur);
  for (const raw of parts) {
    const p = raw.trim();
    if (!p) continue;
    const m = p.match(/^(.*?)\s*<([^<>]+)>$/);
    const address = (m ? m[2] : p).trim();
    const name = m ? m[1].trim().replace(/^"(.*)"$/, "$1").trim() : "";
    if (!validAddress(address)) return { error: `"${p.slice(0, 80)}" isn't an e-mail address.` };
    const k = address.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ name: name.slice(0, 120), address });
  }
  return { list: out };
}

export const formatAddress = (a: MailAddress) => (a.name && a.name !== a.address ? `${a.name} <${a.address}>` : a.address);
export const formatAddressList = (list: MailAddress[]) => list.map(formatAddress).join(", ");

// ─── URL keys ────────────────────────────────────────────────────────────────

/** Mailbox and message ids travel in URLs as base64url, so ids with "/", "+" or ":" stay one path segment. Works in the browser and on the server. */
export function toKey(id: string): string {
  let bin = "";
  for (const b of new TextEncoder().encode(id)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromKey(key: string): string | null {
  if (!/^[A-Za-z0-9_-]{1,2048}$/.test(key)) return null;
  try {
    const bin = atob(key.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (key.length % 4)) % 4));
    const id = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
    return id && toKey(id) === key ? id : null;
  } catch {
    return null;
  }
}
