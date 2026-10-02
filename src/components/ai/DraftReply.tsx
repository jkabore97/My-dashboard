"use client";

import { useState, useTransition } from "react";
import { Copy, PenLine } from "lucide-react";
import { draftReplyAction } from "@/app/actions/assistant";

/** Asks Claude for a reply draft; the owner copies it into Gmail / Outlook. */
export function DraftReply({ emailId, url }: { emailId: string; url?: string }) {
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const btn = "inline-flex items-center gap-1 rounded-md border border-line px-2 py-0.5 text-xs text-muted hover:border-accent/50 hover:text-ink disabled:opacity-50";

  return (
    <div className="pb-3 pl-11">
      {!draft && (
        <button className={btn} disabled={pending} onClick={() => start(async () => { const r = await draftReplyAction(emailId); setDraft(r.draft ?? null); setError(r.error ?? null); })}>
          <PenLine size={12} />{pending ? "Drafting…" : "Draft reply"}
        </button>
      )}
      {error && <p className="mt-1 text-xs text-critical">{error}</p>}
      {draft !== null && (
        <div className="mt-1 grid gap-2">
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={Math.min(14, draft.split("\n").length + 2)} className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent" />
          <div className="flex gap-2">
            <button className={btn} onClick={async () => { await navigator.clipboard.writeText(draft); setCopied(true); }}><Copy size={12} />{copied ? "Copied" : "Copy"}</button>
            {url && <a href={url} target="_blank" rel="noreferrer" className={btn}>Open the email to reply</a>}
            <button className={btn} onClick={() => { setDraft(null); setCopied(false); }}>Discard</button>
          </div>
        </div>
      )}
    </div>
  );
}
