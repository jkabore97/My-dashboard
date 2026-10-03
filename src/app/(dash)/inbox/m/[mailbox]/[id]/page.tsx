import Link from "next/link";
import { ChevronLeft, Download, ExternalLink, Paperclip } from "lucide-react";
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
import { Card } from "@/components/ui";
import { ab } from "@/components/command/hud";
import { MailBody } from "@/components/mail/MailBody";
import { MessageControls } from "@/components/mail/MessageControls";
import { ProviderMark, ReconnectNotice } from "@/components/mail/bits";
import { listQuery, mailDateTime } from "@/components/mail/format";

type Params = Record<string, string | string[] | undefined>;

function Addresses({ label, list }: { label: string; list: MailAddress[] }) {
  if (!list.length) return null;
  return (
    <div className="grid grid-cols-[44px_minmax(0,1fr)] gap-2 text-[13px]">
      <span className="hud-label pt-px text-[11px] text-muted">{label}</span>
      <span className="min-w-0 break-words text-[#c5d3de]">{list.map(formatAddress).join(", ")}</span>
    </div>
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
    <Link href={back} className="mb-3 inline-flex min-h-10 items-center gap-1 text-[13px] text-cyan hover:underline"><ChevronLeft size={15} />Back to the list</Link>
  );

  if (!o || !m) {
    return (
      <>
        {backLink}
        <Card title="Message" accent="pink"><p className="text-[13.5px] text-[#ffc2d1]">{error ?? "That message isn't available."}</p></Card>
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

  return (
    <>
      {backLink}
      {o.perms.reconnect && (
        <div className="mb-4">
          <ReconnectNotice mailbox={ref} canReconnect={ref.owner ? ref.owner === user.email : isFullOwner(user)} compact />
        </div>
      )}
      <article className="grid min-w-0 gap-4">
        <Card
          accent="pink"
          flush
          title={<span className="flex min-w-0 items-center gap-2"><ProviderMark mailbox={ref} /><span className="truncate normal-case tracking-[0.04em]">{ref.label}</span></span>}
          action={mailDateTime(m.receivedAt, tz)}
        >
          <div className="grid gap-3 px-4 py-4 sm:px-5">
            <h1 className="break-words font-display text-[19px] font-semibold leading-snug text-[#f2faff] sm:text-[22px]">
              {m.important && <span className="mr-2 text-high" title="High importance">!</span>}
              {m.subject}
            </h1>
            <div className="grid gap-1.5">
              <Addresses label="From" list={m.from ? [m.from] : []} />
              <Addresses label="To" list={m.to} />
              <Addresses label="Cc" list={m.cc} />
              <Addresses label="Bcc" list={m.bcc} />
              {m.replyTo.length > 0 && <Addresses label="Reply" list={m.replyTo} />}
            </div>
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
          </div>
          {files.length > 0 && (
            <ul className="flex flex-wrap gap-2 border-t border-line/60 px-4 py-3 sm:px-5" aria-label="Attachments">
              {files.map((a) => (
                <li key={a.id} className="min-w-0 max-w-full">
                  <a href={`/api/mail/attachment?mb=${ref.key}&m=${msgKey}&a=${toKey(a.id)}`} download={a.name} className={`${ab} max-w-full`}>
                    <Paperclip size={13} className="shrink-0" />
                    <span className="min-w-0 truncate font-sans normal-case tracking-normal">{a.name}</span>
                    <span className="shrink-0 font-mono text-[11px] text-muted">{formatBytes(a.size)}</span>
                    <Download size={13} className="shrink-0" />
                  </a>
                </li>
              ))}
            </ul>
          )}
          <div className="border-t border-line/60">
            <MailBody html={m.html} text={m.text} />
          </div>
          {m.webLink && (
            <div className="border-t border-line/60 px-4 py-3 sm:px-5">
              <a href={m.webLink} target="_blank" rel="noreferrer" className={ab}><ExternalLink size={13} />Open in {o.h.provider === "gmail" ? "Gmail" : "Outlook"}</a>
            </div>
          )}
        </Card>
      </article>
    </>
  );
}
