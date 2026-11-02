"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Paperclip, PenLine, Send, X } from "lucide-react";
import { draftMailReplyAction } from "@/app/actions/mail";
import { formatBytes, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS, MAX_TOTAL_ATTACHMENT_BYTES } from "@/lib/mail/limits";
import type { ComposeMode } from "@/lib/mail/types";
import { ab } from "../command/hud";

const field = "min-h-10 min-w-0 flex-1 bg-transparent py-2 text-base text-ink outline-none placeholder:text-muted/70 sm:text-[15px]";
const red = `${ab} rounded-full`.replace("text-cyan", "text-critical");
const TITLE: Record<ComposeMode, string> = { new: "New message", reply: "Reply", replyAll: "Reply all", forward: "Forward" };

export interface ComposerProps {
  mailbox: { key: string; label: string; address: string };
  mode: ComposeMode;
  /** The message answered / forwarded (its URL key). */
  messageKey?: string;
  defaults: { to: string; cc: string; subject: string };
  /** Claude can draft the reply. */
  ai: boolean;
  /** Where to go after sending. */
  backHref: string;
  onCancel?: () => void;
}

/** Plain-text composer: what's typed is sent as simple HTML, above the quoted thread for replies and forwards. */
export function Composer({ mailbox, mode, messageKey, defaults, ai, backHref, onCancel }: ComposerProps) {
  const router = useRouter();
  const [to, setTo] = useState(defaults.to);
  const [cc, setCc] = useState(defaults.cc);
  const [bcc, setBcc] = useState("");
  const [showCc, setShowCc] = useState(!!defaults.cc);
  const [showBcc, setShowBcc] = useState(false);
  const [subject, setSubject] = useState(defaults.subject);
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [drafting, startDraft] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const next = [...files];
    for (const f of Array.from(list)) {
      if (f.size > MAX_ATTACHMENT_BYTES) return setError(`${f.name} is larger than ${formatBytes(MAX_ATTACHMENT_BYTES)}. Share a link to it instead.`);
      next.push(f);
    }
    if (next.length > MAX_ATTACHMENTS) return setError(`At most ${MAX_ATTACHMENTS} attachments.`);
    if (next.reduce((n, f) => n + f.size, 0) > MAX_TOTAL_ATTACHMENT_BYTES) return setError(`Attachments can add up to ${formatBytes(MAX_TOTAL_ATTACHMENT_BYTES)} at most.`);
    setError(null);
    setFiles(next);
  };

  const draft = () =>
    startDraft(async () => {
      if (!messageKey) return;
      if (body.trim() && !confirm("Replace what you've written with Claude's draft?")) return;
      const r = await draftMailReplyAction(mailbox.key, messageKey);
      if (r.draft) setBody(r.draft);
      setError(r.error ?? null);
    });

  const send = async () => {
    const recipients = [to, cc, bcc].join(",").split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
    if (!recipients.length) return setError("Add at least one recipient.");
    if (!body.trim() && mode !== "forward") return setError("Write a message first.");
    const shown = recipients.length > 3 ? `${recipients.slice(0, 3).join(", ")} and ${recipients.length - 3} more` : recipients.join(", ");
    if (!confirm(`Send "${subject || "(no subject)"}" from ${mailbox.address} to ${shown}?`)) return;
    const form = new FormData();
    form.set("mailbox", mailbox.key);
    form.set("mode", mode);
    if (messageKey) form.set("message", messageKey);
    form.set("to", to);
    form.set("cc", showCc ? cc : "");
    form.set("bcc", showBcc ? bcc : "");
    form.set("subject", subject);
    form.set("body", body);
    for (const f of files) form.append("files", f);
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/mail/send", { method: "POST", body: form });
      const r = (await res.json().catch(() => ({ ok: false, error: `The server answered ${res.status}.` }))) as { ok: boolean; error?: string; demo?: boolean };
      if (!r.ok) {
        setError(r.error ?? "Sending failed.");
        setSending(false);
        return;
      }
      router.push(`${backHref}${backHref.includes("?") ? "&" : "?"}sent=${r.demo ? "demo" : "1"}`);
      router.refresh();
    } catch {
      setError("Couldn't reach the dashboard. Check your connection; the message was not sent.");
      setSending(false);
    }
  };

  const sendLabel = sending ? "Sending…" : mode === "new" ? "Send" : mode === "forward" ? "Send forward" : "Send reply";
  const row = (label: string, input: React.ReactNode, extra?: React.ReactNode) => (
    <label className="flex min-h-11 items-center gap-2 border-b border-line px-4 sm:px-5">
      <span className="shrink-0 text-[15px] text-muted">{label}:</span>
      {input}
      {extra}
    </label>
  );

  return (
    <section className="overflow-hidden rounded-[14px] bg-panel shadow-[0_0_0_1px_var(--color-line),0_10px_40px_rgb(0_0_0/0.08)]" aria-label={TITLE[mode]}>
      <header className="flex items-center justify-between gap-2 border-b border-line px-3 py-2 sm:px-4">
        {onCancel ? (
          <button type="button" className="min-h-10 rounded-lg px-2 text-[15px] text-cyan hover:opacity-70 disabled:opacity-40" onClick={onCancel} disabled={sending}>Cancel</button>
        ) : <span className="w-16" />}
        <h2 className="min-w-0 truncate text-[17px] font-semibold text-ink">{TITLE[mode]}</h2>
        <button type="button" disabled={sending} onClick={send} className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-cyan px-3.5 text-[15px] font-semibold text-white transition hover:brightness-110 active:opacity-80 disabled:opacity-50" aria-label={sendLabel}>
          <Send size={15} /><span className="max-sm:sr-only">{sendLabel}</span>
        </button>
      </header>
      <div className="grid grid-cols-[minmax(0,1fr)]">
        {row("To", <input className={field} value={to} onChange={(e) => setTo(e.target.value)} placeholder="name@example.com, …" autoComplete="off" inputMode="email" />,
          (!showCc || !showBcc) && (
            <span className="flex shrink-0 gap-1">
              {!showCc && <button type="button" className="min-h-8 rounded-md px-1.5 text-[14px] text-cyan hover:bg-fill" onClick={() => setShowCc(true)}>Cc</button>}
              {!showBcc && <button type="button" className="min-h-8 rounded-md px-1.5 text-[14px] text-cyan hover:bg-fill" onClick={() => setShowBcc(true)}>Bcc</button>}
            </span>
          ))}
        {showCc && row("Cc", <input className={field} value={cc} onChange={(e) => setCc(e.target.value)} autoComplete="off" inputMode="email" />)}
        {showBcc && row("Bcc", <input className={field} value={bcc} onChange={(e) => setBcc(e.target.value)} autoComplete="off" inputMode="email" />)}
        <div className="flex min-h-11 items-center gap-2 border-b border-line px-4 text-[15px] sm:px-5">
          <span className="shrink-0 text-muted">From:</span>
          <span className="min-w-0 truncate text-ink">{mailbox.address}</span>
        </div>
        {row("Subject", <input className={field} value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={400} />)}
        <label className="block">
          <span className="sr-only">Message</span>
          <textarea className="block min-h-[240px] w-full resize-y bg-transparent px-4 py-3 text-base leading-relaxed text-ink outline-none placeholder:text-muted/70 sm:px-5 sm:text-[15px]" value={body} onChange={(e) => setBody(e.target.value)} rows={10} placeholder={mode === "new" ? "Write your message" : mode === "forward" ? "Add a note (the original and its attachments follow)" : "Write your reply (the original is quoted below it)"} />
        </label>
        {files.length > 0 && (
          <ul className="grid gap-1.5 px-4 pb-3 sm:px-5">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex min-w-0 items-center gap-2 rounded-[10px] bg-panel-2 py-1 pl-3 pr-1 text-[14px] text-ink">
                <Paperclip size={14} className="shrink-0 text-muted" />
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                <span className="shrink-0 text-[12px] text-muted">{formatBytes(f.size)}</span>
                <button type="button" className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-muted hover:bg-fill hover:text-critical sm:h-8 sm:w-8" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}><X size={15} /></button>
              </li>
            ))}
          </ul>
        )}
        {error && <p role="alert" className="mx-4 mb-3 rounded-[14px] bg-critical/10 px-4 py-3 text-[15px] text-ink sm:mx-5"><b className="font-semibold text-critical">Not sent.</b> {error}</p>}
        <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3 sm:px-5">
          <input ref={fileInput} type="file" multiple className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
          <button type="button" className={`${ab} rounded-full`} onClick={() => fileInput.current?.click()} disabled={sending}><Paperclip size={14} />Attach</button>
          {ai && messageKey && mode !== "forward" && (
            <button type="button" className={`${ab} rounded-full`} disabled={drafting || sending} onClick={draft}><PenLine size={14} />{drafting ? "Drafting…" : "Draft with Claude"}</button>
          )}
          {onCancel && <button type="button" className={red} onClick={onCancel} disabled={sending}><X size={14} />Discard</button>}
          <span className="basis-full text-[12px] text-muted sm:ml-auto sm:basis-auto">Up to {formatBytes(MAX_TOTAL_ATTACHMENT_BYTES)} of attachments.</span>
        </div>
      </div>
    </section>
  );
}
