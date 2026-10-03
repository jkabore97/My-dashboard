import { htmlToText } from "./html";
import { PAGE_SIZE } from "./limits";
import type { MailFolder, MailListItem, MailMessage, MailPage, SendRequest } from "./types";

// A sample mailbox so the mail client renders in local development with
// nothing connected. Only used when sample data is on AND the server isn't a
// production build (see demoMailAllowed in src/lib/server/mail.ts): it never
// appears in production. Changes (read, flag, archive, delete) live in memory.

export const DEMO_MAILBOX = { id: "demo:Kaj Consulting", address: "hello@kajconsulting.example", label: "Kaj Consulting (sample)", business: "Kaj Consulting" };

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const PEOPLE = [
  ["Ama Mensah", "ama@clientco.example"],
  ["Stripe", "notifications@stripe.com"],
  ["Ibrahim Ouédraogo", "ibrahim@shipping.example"],
  ["Vercel", "notifications@vercel.com"],
  ["Lena Fischer", "lena@designhaus.example"],
  ["GitHub", "noreply@github.com"],
  ["Marc Dupont", "marc@bank.example"],
  ["Google Workspace", "workspace-noreply@google.com"],
] as const;
const SUBJECTS = [
  "Re: Q4 proposal — next steps",
  "Payment dispute opened: $480.00",
  "Container ETA for order #4471",
  "Failed production deployment on client-portal",
  "Logo concepts v2",
  "[kaj/client-portal] Dependabot alert: next (high)",
  "Your statement is ready",
  "Your monthly invoice is available",
];

interface DemoMsg extends MailMessage {
  folder: string;
}

let store: DemoMsg[] | null = null;

function seed(): DemoMsg[] {
  const out: DemoMsg[] = [];
  for (let i = 0; i < 46; i++) {
    const [name, address] = PEOPLE[i % PEOPLE.length];
    const subject = SUBJECTS[i % SUBJECTS.length] + (i >= SUBJECTS.length ? ` (${Math.floor(i / SUBJECTS.length) + 1})` : "");
    const rich = i % 3 === 0;
    const html = rich
      ? `<div style="font-family:Arial"><h2 style="color:#0b62c4">${subject}</h2><p>Hello Kaj,</p><p>Thanks for your message. Here are the details we discussed, with the summary below.</p><p><img src="https://example.com/tracking-pixel.png?id=${i}" alt="Remote picture (blocked until you allow images)" width="320" height="80" style="background:#eef"></p><script>alert("this never runs")</script><p onclick="alert(1)">Best regards,<br>${name}</p><p><a href="https://example.com/details">View the details</a></p></div>`
      : null;
    const text = rich ? htmlToText(html!) : `Hello Kaj,\n\nThanks for your message. Can we meet Thursday to finalize scope and pricing?\n\nBest,\n${name}`;
    out.push({
      id: `demo-${i + 1}`,
      folder: i % 11 === 5 ? "sentitems" : i % 13 === 7 ? "archive" : i === 9 ? "junkemail" : "inbox",
      subject,
      from: { name, address },
      to: [{ name: "Kaj Consulting", address: DEMO_MAILBOX.address }],
      cc: i % 4 === 0 ? [{ name: "Ops", address: "ops@kajconsulting.example" }] : [],
      bcc: [],
      replyTo: [],
      preview: text.replace(/\s+/g, " ").slice(0, 200),
      receivedAt: ago(35 + i * 190),
      sentAt: ago(36 + i * 190),
      unread: i < 7 || i % 5 === 0,
      flagged: i % 9 === 2,
      hasAttachments: i % 4 === 1,
      important: i % 8 === 1,
      draft: false,
      html,
      text,
      attachments: i % 4 === 1 ? [{ id: "att-1", name: `summary-${i + 1}.txt`, contentType: "text/plain", size: 64, inline: false }] : [],
      webLink: null,
    });
  }
  return out;
}

const all = () => (store ??= seed());

export function demoFolders(): MailFolder[] {
  const count = (f: string) => ({ unread: all().filter((m) => m.folder === f && m.unread).length, total: all().filter((m) => m.folder === f).length });
  return [
    { id: "inbox", name: "Inbox", wellKnown: "inbox", ...count("inbox") },
    { id: "sentitems", name: "Sent", wellKnown: "sent", ...count("sentitems") },
    { id: "drafts", name: "Drafts", wellKnown: "drafts", ...count("drafts") },
    { id: "archive", name: "Archive", wellKnown: "archive", ...count("archive") },
    { id: "junkemail", name: "Junk", wellKnown: "junk", ...count("junkemail") },
    { id: "deleteditems", name: "Deleted", wellKnown: "deleted", ...count("deleteditems") },
    { id: "clients", name: "Clients", ...count("clients") },
  ];
}

const listItem = ({ folder: _f, cc: _c, bcc: _b, replyTo: _r, sentAt: _s, html: _h, text: _t, attachments: _a, webLink: _w, ...item }: DemoMsg): MailListItem => item;

export function demoList(o: { folder: string; search?: string | null; unread?: boolean; cursor?: string | null }): MailPage {
  const q = o.search?.trim().toLowerCase();
  const rows = all()
    .filter((m) => m.folder === o.folder && (!o.unread || m.unread) && (!q || `${m.subject} ${m.from?.name} ${m.from?.address} ${m.text}`.toLowerCase().includes(q)))
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  const start = Math.max(0, Number(o.cursor) || 0);
  const page = rows.slice(start, start + PAGE_SIZE);
  return { items: page.map(listItem), next: start + PAGE_SIZE < rows.length ? String(start + PAGE_SIZE) : null };
}

export function demoMessage(id: string): MailMessage | null {
  const m = all().find((x) => x.id === id);
  if (!m) return null;
  const { folder: _f, ...msg } = m;
  return msg;
}

export function demoAttachment(id: string, attachmentId: string) {
  const m = all().find((x) => x.id === id);
  const a = m?.attachments.find((x) => x.id === attachmentId);
  if (!m || !a) return null;
  const data = new TextEncoder().encode(`Sample attachment for "${m.subject}".\n`);
  return { name: a.name, contentType: a.contentType, size: data.length, body: new Blob([data]).stream() };
}

export function demoUpdate(id: string, change: { read?: boolean; flagged?: boolean; folder?: string }) {
  const m = all().find((x) => x.id === id);
  if (!m) return false;
  if (change.read !== undefined) m.unread = !change.read;
  if (change.flagged !== undefined) m.flagged = change.flagged;
  if (change.folder) m.folder = change.folder;
  return true;
}

/** Sample mailbox: the message goes to Sent, nothing leaves the machine. */
export function demoSend(req: SendRequest) {
  all().unshift({
    id: `demo-sent-${Date.now()}`,
    folder: "sentitems",
    subject: req.subject || "(no subject)",
    from: { name: "Kaj Consulting", address: DEMO_MAILBOX.address },
    to: req.to,
    cc: req.cc,
    bcc: req.bcc,
    replyTo: [],
    preview: req.body.slice(0, 200),
    receivedAt: new Date().toISOString(),
    sentAt: new Date().toISOString(),
    unread: false,
    flagged: false,
    hasAttachments: req.attachments.length > 0,
    important: false,
    draft: false,
    html: null,
    text: req.body,
    attachments: [],
    webLink: null,
  });
}
