"use client";

import { useRef, useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { Paperclip, PenLine, Send, X } from "lucide-react";
import { draftMailReplyAction } from "@/app/actions/mail";
import { formatBytes, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS, MAX_TOTAL_ATTACHMENT_BYTES } from "@/lib/mail/limits";
import type { ComposeMode } from "@/lib/mail/types";
import { ab } from "../command/hud";

const field = "hud-input w-full min-h-10 px-3 py-2 text-base sm:text-[13.5px] placeholder:text-muted/70";
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

  return (
    <section className="hud-panel" style={{ "--a": "#ff5fd7" } as CSSProperties} aria-label={TITLE[mode]}>
      <header className="hud-head flex flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-5">
        <h2 className="hud-title text-[13px]">{TITLE[mode]}</h2>
        <span className="hud-label min-w-0 truncate text-[11px] tracking-[0.12em] text-muted">from {mailbox.address}</span>
      </header>
      <div className="grid gap-2.5 px-4 py-4 sm:px-5">
        <label className="grid gap-1">
          <span className="hud-label text-[11px] text-muted">To</span>
          <input className={field} value={to} onChange={(e) => setTo(e.target.value)} placeholder="name@example.com, …" autoComplete="off" inputMode="email" />
        </label>
        {showCc && (
          <label className="grid gap-1">
            <span className="hud-label text-[11px] text-muted">Cc</span>
            <input className={field} value={cc} onChange={(e) => setCc(e.target.value)} autoComplete="off" inputMode="email" />
          </label>
        )}
        {showBcc && (
          <label className="grid gap-1">
            <span className="hud-label text-[11px] text-muted">Bcc</span>
            <input className={field} value={bcc} onChange={(e) => setBcc(e.target.value)} autoComplete="off" inputMode="email" />
          </label>
        )}
        {(!showCc || !showBcc) && (
          <div className="flex gap-2">
            {!showCc && <button type="button" className={ab} onClick={() => setShowCc(true)}>+ Cc</button>}
            {!showBcc && <button type="button" className={ab} onClick={() => setShowBcc(true)}>+ Bcc</button>}
          </div>
        )}
        <label className="grid gap-1">
          <span className="hud-label text-[11px] text-muted">Subject</span>
          <input className={field} value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={400} />
        </label>
        <label className="grid gap-1">
          <span className="hud-label flex items-center justify-between text-[11px] text-muted">
            <span>Message</span>
            {mode !== "new" && mode !== "forward" ? <span className="normal-case tracking-normal">the original is quoted below it</span> : mode === "forward" ? <span className="normal-case tracking-normal">the original and its attachments follow</span> : null}
          </span>
          <textarea className={`${field} min-h-[220px] leading-relaxed`} value={body} onChange={(e) => setBody(e.target.value)} rows={10} />
        </label>
        {files.length > 0 && (
          <ul className="grid gap-1.5">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex min-w-0 items-center gap-2 border border-line/60 px-2.5 py-1.5 text-[13px]">
                <Paperclip size={13} className="shrink-0 text-muted" />
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                <span className="shrink-0 font-mono text-[11.5px] text-muted">{formatBytes(f.size)}</span>
                <button type="button" className="grid h-10 w-10 shrink-0 place-items-center text-muted hover:text-critical sm:h-8 sm:w-8" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}><X size={14} /></button>
              </li>
            ))}
          </ul>
        )}
        {error && <p role="alert" className="border-l-2 border-critical bg-critical/10 px-3 py-2 text-[13px] text-[#ffc2d1]">{error}</p>}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button type="button" disabled={sending} onClick={send} className="hud-btn hud-btn-solid inline-flex min-h-10 items-center gap-1.5 px-4 [--b:#ff5fd7]">
            <Send size={14} />{sending ? "Sending…" : mode === "new" ? "Send" : mode === "forward" ? "Send forward" : "Send reply"}
          </button>
          <input ref={fileInput} type="file" multiple className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
          <button type="button" className={ab} onClick={() => fileInput.current?.click()} disabled={sending}><Paperclip size={13} />Attach</button>
          {ai && messageKey && mode !== "forward" && (
            <button type="button" className={`${ab} border-violet/60 bg-violet/10 text-[#e1d8ff]`} disabled={drafting || sending} onClick={draft}><PenLine size={13} />{drafting ? "Drafting…" : "Draft with Claude"}</button>
          )}
          {onCancel && <button type="button" className={ab} onClick={onCancel} disabled={sending}><X size={13} />Discard</button>}
          <span className="basis-full text-[11.5px] text-muted sm:basis-auto">Up to {formatBytes(MAX_TOTAL_ATTACHMENT_BYTES)} of attachments.</span>
        </div>
      </div>
    </section>
  );
}
