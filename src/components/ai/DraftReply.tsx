"use client";

import { useState, useTransition } from "react";
import { Copy, ExternalLink, PenLine, X } from "lucide-react";
import { draftReplyAction } from "@/app/actions/assistant";
import { ab } from "../command/hud";

const pill = `${ab} rounded-full`;

/** Asks Claude for a reply draft; the owner copies it into Gmail / Outlook. */
export function DraftReply({ emailId, url, provider = "Gmail" }: { emailId: string; url?: string; provider?: string }) {
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (draft === null) {
    return (
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <button className={pill} disabled={pending} onClick={() => start(async () => { const r = await draftReplyAction(emailId); setDraft(r.draft ?? null); setError(r.error ?? null); })}>
          <PenLine size={14} />{pending ? "Drafting…" : "Draft reply"}
        </button>
        {url && <a href={url} target="_blank" rel="noreferrer" className={pill}><ExternalLink size={14} />Open in {provider}</a>}
        {error && <p className="basis-full text-[13px] text-critical">{error}</p>}
      </div>
    );
  }
  return (
    <div className="mt-3">
      <div className="flex items-baseline justify-between gap-2 text-[13px]">
        <span className="font-semibold text-ink">Reply draft by Claude</span>
        <span className="text-muted">Edit before sending</span>
      </div>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={Math.min(14, draft.split("\n").length + 2)}
        className="hud-input mt-1.5 w-full px-3.5 py-3 text-[15px] leading-relaxed"
      />
      <div className="mt-2 flex flex-wrap gap-2">
        <button className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-cyan px-3.5 text-[13px] font-semibold text-white transition hover:brightness-110 active:opacity-80 sm:min-h-8" onClick={async () => { await navigator.clipboard.writeText(draft); setCopied(true); }}><Copy size={14} />{copied ? "Copied ✓" : "Copy"}</button>
        {url && <a href={url} target="_blank" rel="noreferrer" className={pill}><ExternalLink size={14} />Open the email to reply</a>}
        <button className={pill} onClick={() => { setDraft(null); setCopied(false); }}><X size={14} />Discard</button>
      </div>
    </div>
  );
}
