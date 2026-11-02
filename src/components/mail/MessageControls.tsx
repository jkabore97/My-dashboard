"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, Flag, FlagOff, Forward, Mail, MailOpen, Reply, ReplyAll, Trash2 } from "lucide-react";
import { changeMailAction } from "@/app/actions/mail";
import type { ComposeMode, MailPermissions } from "@/lib/mail/types";
import { ab } from "../command/hud";
import { Composer } from "./Composer";

const pill = `${ab} rounded-full`;
const on = `${pill.replace("bg-fill ", "bg-cyan ").replace("text-cyan", "text-white").replace("hover:bg-fill-2", "hover:brightness-110")}`;
const red = pill.replace("text-cyan", "text-critical");

export interface ReplyDefaults {
  to: string;
  cc: string;
  subject: string;
}

/**
 * The message toolbar: reply / reply all / forward (opens the composer under
 * it), read state, flag, archive and delete. Opening an unread message marks
 * it read (from here, not from the page render, so a prefetch never does).
 */
export function MessageControls(p: {
  mailbox: { key: string; label: string; address: string };
  messageKey: string;
  unread: boolean;
  flagged: boolean;
  perms: Pick<MailPermissions, "triage" | "organize" | "send" | "sendBlocked">;
  defaults: Record<Exclude<ComposeMode, "new">, ReplyDefaults>;
  ai: boolean;
  backHref: string;
  /** Hide Delete in Deleted Items / Trash. */
  inTrash: boolean;
  /** Open the composer at once (?compose=reply from the list). */
  initialMode?: Exclude<ComposeMode, "new"> | null;
}) {
  const router = useRouter();
  const [unread, setUnread] = useState(p.unread);
  const [flagged, setFlagged] = useState(p.flagged);
  const [mode, setMode] = useState<Exclude<ComposeMode, "new"> | null>(p.perms.send ? (p.initialMode ?? null) : null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const marked = useRef(false);

  useEffect(() => {
    if (marked.current || !p.unread || !p.perms.triage) return;
    marked.current = true;
    void changeMailAction(p.mailbox.key, p.messageKey, { kind: "read", read: true }).then((r) => (r.ok ? setUnread(false) : null));
  }, [p.unread, p.perms.triage, p.mailbox.key, p.messageKey]);

  const act = (change: Parameters<typeof changeMailAction>[2], after?: () => void) =>
    start(async () => {
      const r = await changeMailAction(p.mailbox.key, p.messageKey, change);
      if (r.error) return setError(r.error);
      setError(null);
      after?.();
    });

  const leave = () => {
    router.push(p.backHref);
    router.refresh();
  };

  const replyBtn = (m: Exclude<ComposeMode, "new">, label: string, Icon: typeof Reply) => (
    <button type="button" className={mode === m ? on : pill} onClick={() => setMode(mode === m ? null : m)} aria-pressed={mode === m}>
      <Icon size={15} />{label}
    </button>
  );

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        {p.perms.send && (
          <>
            {replyBtn("reply", "Reply", Reply)}
            {replyBtn("replyAll", "Reply all", ReplyAll)}
            {replyBtn("forward", "Forward", Forward)}
          </>
        )}
        {p.perms.triage && (
          <>
            <button type="button" className={pill} disabled={pending} onClick={() => act({ kind: "read", read: unread }, () => setUnread(!unread))}>
              {unread ? <MailOpen size={15} /> : <Mail size={15} />}<span className="max-sm:sr-only">{unread ? "Mark read" : "Mark unread"}</span>
            </button>
            <button type="button" className={pill} disabled={pending} onClick={() => act({ kind: "flag", flagged: !flagged }, () => setFlagged(!flagged))} aria-pressed={flagged}>
              {flagged ? <FlagOff size={15} /> : <Flag size={15} />}<span className="max-sm:sr-only">{flagged ? "Unflag" : "Flag"}</span>
            </button>
          </>
        )}
        {p.perms.organize && (
          <>
            <button type="button" className={pill} disabled={pending} onClick={() => act({ kind: "archive" }, leave)}><Archive size={15} /><span className="max-sm:sr-only">Archive</span></button>
            {!p.inTrash && (
              <button type="button" className={red} disabled={pending} onClick={() => confirm("Move this message to Deleted Items? You can restore it from there.") && act({ kind: "delete" }, leave)}>
                <Trash2 size={15} /><span className="max-sm:sr-only">Delete</span>
              </button>
            )}
          </>
        )}
      </div>
      {!p.perms.send && p.perms.sendBlocked && <p className="text-[13px] text-muted">{p.perms.sendBlocked}</p>}
      {error && <p role="alert" className="rounded-[14px] bg-critical/10 px-4 py-3 text-[15px] text-ink"><b className="font-semibold text-critical">Didn&apos;t work.</b> {error}</p>}
      {mode && (
        <Composer key={mode} mailbox={p.mailbox} mode={mode} messageKey={p.messageKey} defaults={p.defaults[mode]} ai={p.ai} backHref={p.backHref} onCancel={() => setMode(null)} />
      )}
    </div>
  );
}
