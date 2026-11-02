import Link from "next/link";
import { ChevronLeft, Download, ExternalLink, Flag, Paperclip } from "lucide-react";
import { requireSection } from "@/lib/server/auth";
import { aiEnabled } from "@/lib/server/ai";
import { getPrefs } from "@/lib/server/alerts/store";
import { businessTimeZone } from "@/lib/dates";
import { errorMessage } from "@/lib/source";
import { isFullOwner } from "@/lib/access";
import { formatAddress, fromKey, toKey } from "@/lib/mail/access";
import { formatBytes } from "@/lib/mail/limits";
import type { MailAddress, MailMessage } from "@/lib/mail/types";
import { getMessage, MailAccessError, openMailbox, publicRef, replyRecipients, replySubject, wellKnownId, type OpenMailbox } from "@/lib/server/mail";
import { businessColor } from "@/components/ui";
import { ab } from "@/components/command/hud";
import { MailBody } from "@/components/mail/MailBody";
import { MessageControls } from "@/components/mail/MessageControls";
import { ProviderMark, ReconnectNotice } from "@/components/mail/bits";
import { listQuery, mailDateTime, personName } from "@/components/mail/format";

type Params = Record<string, string | string[] | undefined>;

function Addresses({ label, list }: { label: string; list: MailAddress[] }) {
  if (!list.length) return null;
  return (
    <div className="text-[13px] leading-snug">
      <span className="text-muted">{label}: </span>
      <span className="break-words text-ink">{list.map(formatAddress).join(", ")}</span>
    </div>
  );
}

/** Apple Mail's sender circle: initials on a grey (or identity) disc. */
function SenderAvatar({ name }: { name: string }) {
  const parts = name.replace(/[<>"]/g, "").trim().split(/[\s@.]+/).filter(Boolean);
  const initials = ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[1][0] : "")).toUpperCase();
  return (
    <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-[15px] font-semibold text-white" style={{ background: `linear-gradient(180deg, color-mix(in srgb, ${businessColor(name)} 70%, white), ${businessColor(name)})` }}>
      {initials}
    </span>
  );
}

export default async function MessagePage({ params, searchParams }: { params: Promise<{ mailbox: string; id: string }>; searchParams: Promise<Params> }) {
  const user = await requireSection("inbox");
  const { mailbox, id } = await params;
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const folder = one("f");
  const back = `/inbox?${listQuery({ mb: mailbox, f: folder, q: one("q"), unread: one("unread") === "1", c: one("c") })}`;
  const messageId = fromKey(id);

  let o: OpenMailbox | null = null;
  let m: MailMessage | null = null;
  let error: string | null = null;
  try {
    if (!messageId) throw new MailAccessError("That message link isn't valid.");
    o = await openMailbox(user, mailbox, "read");
    m = await getMessage(o, messageId);
  } catch (err) {
    error = err instanceof MailAccessError ? err.message : errorMessage(err);
  }

  const backLink = (
    <Link href={back} className="-ml-1.5 mb-2 inline-flex min-h-10 items-center gap-0.5 text-[17px] text-cyan hover:opacity-70"><ChevronLeft size={22} />Inbox</Link>
  );

  if (!o || !m) {
    return (
      <>
        {backLink}
        <div className="rounded-[14px] bg-critical/10 px-4 py-3 text-[15px] text-ink"><b className="font-semibold text-critical">Can&apos;t open this message.</b> {error ?? "That message isn't available."}</div>
      </>
    );
  }

  const prefs = await getPrefs(user.email).catch(() => null);
  const tz = prefs?.timeZone ?? businessTimeZone();
  const ref = publicRef(o.h);
  const self = o.h.address;
  const defaults = {
    reply: { ...replyRecipients("reply", m, self), subject: replySubject("reply", m.subject) },
    replyAll: { ...replyRecipients("replyAll", m, self), subject: replySubject("replyAll", m.subject) },
    forward: { ...replyRecipients("forward", m, self), subject: replySubject("forward", m.subject) },
  };
  const compose = one("compose");
  const initialMode = compose === "reply" || compose === "replyAll" || compose === "forward" ? compose : null;
  const inTrash = !!folder && folder === wellKnownId(o.h.provider, "deleted");
  const files = m.attachments.filter((a) => !a.inline);
  const msgKey = toKey(m.id);
  const sender = personName(m.from) || "(unknown sender)";

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-x-3">
        {backLink}
        <span className="mb-2 flex min-w-0 items-center gap-1.5 text-[13px] text-muted"><ProviderMark mailbox={ref} /><span className="truncate">{ref.label}</span></span>
      </div>
      {o.perms.reconnect && (
        <div className="mb-4">
          <ReconnectNotice mailbox={ref} canReconnect={ref.owner ? ref.owner === user.email : isFullOwner(user)} compact />
        </div>
      )}
      <article className="hud-panel min-w-0 overflow-hidden">
        <header className="grid gap-4 px-4 pb-4 pt-4 sm:px-6 sm:pt-5">
          <div className="flex items-start gap-3">
            <SenderAvatar name={sender} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="min-w-0 break-words text-[17px] font-semibold text-ink">{sender}</span>
                <span className="shrink-0 text-[13px] text-muted">{mailDateTime(m.receivedAt, tz)}</span>
              </div>
              {m.from && m.from.name && m.from.name !== m.from.address && <div className="break-words text-[13px] text-muted">{m.from.address}</div>}
              <div className="mt-1 grid gap-0.5">
                <Addresses label="To" list={m.to} />
                <Addresses label="Cc" list={m.cc} />
                <Addresses label="Bcc" list={m.bcc} />
                {m.replyTo.length > 0 && <Addresses label="Reply to" list={m.replyTo} />}
              </div>
            </div>
          </div>
          <h1 className="break-words text-[22px] font-bold leading-tight tracking-[-0.01em] text-ink sm:text-[26px]">
            {m.important && <span className="mr-2 text-warn" title="High importance">!</span>}
            {m.subject}
            {m.flagged && <Flag size={16} className="ml-2 inline -translate-y-0.5 fill-current text-high" aria-label="Flagged" />}
          </h1>
          <MessageControls
            mailbox={{ key: ref.key, label: ref.label, address: ref.address }}
            messageKey={msgKey}
            unread={m.unread}
            flagged={m.flagged}
            perms={{ triage: o.perms.triage, organize: o.perms.organize, send: o.perms.send, sendBlocked: o.perms.sendBlocked }}
            defaults={defaults}
            ai={aiEnabled()}
            backHref={back}
            inTrash={inTrash}
            initialMode={initialMode}
          />
        </header>
        {files.length > 0 && (
          <ul className="flex flex-wrap gap-2 border-t border-line px-4 py-3 sm:px-6" aria-label="Attachments">
            {files.map((a) => (
              <li key={a.id} className="min-w-0 max-w-full">
                <a href={`/api/mail/attachment?mb=${ref.key}&m=${msgKey}&a=${toKey(a.id)}`} download={a.name} className="flex min-h-11 max-w-full items-center gap-2.5 rounded-[12px] bg-panel-2 px-3 py-2 text-ink shadow-[0_0_0_1px_var(--color-line)] transition hover:bg-fill">
                  <Paperclip size={16} className="shrink-0 text-muted" />
                  <span className="min-w-0">
                    <span className="block truncate text-[14px] font-medium">{a.name}</span>
                    <span className="block text-[12px] text-muted">{formatBytes(a.size)}</span>
                  </span>
                  <Download size={16} className="shrink-0 text-cyan" />
                </a>
              </li>
            ))}
          </ul>
        )}
        <div className="border-t border-line">
          <MailBody html={m.html} text={m.text} />
        </div>
        {m.webLink && (
          <div className="border-t border-line px-4 py-3 sm:px-6">
            <a href={m.webLink} target="_blank" rel="noreferrer" className={`${ab} rounded-full`}><ExternalLink size={14} />Open in {o.h.provider === "gmail" ? "Gmail" : "Outlook"}</a>
          </div>
        )}
      </article>
    </>
  );
}
