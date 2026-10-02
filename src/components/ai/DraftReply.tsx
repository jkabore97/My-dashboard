"use client";

import { useState, useTransition } from "react";
import { Copy, ExternalLink, PenLine, X } from "lucide-react";
import { draftReplyAction } from "@/app/actions/assistant";
import { ab } from "../command/hud";

const ai = `${ab} border-violet/60 bg-violet/10 text-[#e1d8ff]`;

/** Asks Claude for a reply draft; the owner copies it into Gmail / Outlook. */
export function DraftReply({ emailId, url, provider = "Gmail" }: { emailId: string; url?: string; provider?: string }) {
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (draft === null) {
    return (
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <button className={ai} disabled={pending} onClick={() => start(async () => { const r = await draftReplyAction(emailId); setDraft(r.draft ?? null); setError(r.error ?? null); })}>
          <PenLine size={13} />{pending ? "Drafting…" : "Draft reply"}
        </button>
        {url && <a href={url} target="_blank" rel="noreferrer" className={ab}><ExternalLink size={13} />Open in {provider}</a>}
        {error && <p className="basis-full text-xs text-critical">{error}</p>}
      </div>
    );
  }
  return (
    <div className="mt-3">
      <div className="hud-label flex items-center justify-between gap-2 text-[11px] text-pink">
        <span>✦ Reply draft · Claude</span>
        <span className="font-mono normal-case tracking-normal text-muted">edit before sending</span>
      </div>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={Math.min(14, draft.split("\n").length + 2)}
        className="hud-cut mt-2 w-full border border-pink/40 bg-[#040a10]/60 px-3.5 py-3 text-[13.5px] leading-relaxed text-[#e3eef6] outline-none focus:border-pink"
      />
      <div className="mt-2 flex flex-wrap gap-2">
        <button className={ai} onClick={async () => { await navigator.clipboard.writeText(draft); setCopied(true); }}><Copy size={13} />{copied ? "Copied" : "Copy"}</button>
        {url && <a href={url} target="_blank" rel="noreferrer" className={ab}><ExternalLink size={13} />Open the email to reply</a>}
        <button className={ab} onClick={() => { setDraft(null); setCopied(false); }}><X size={13} />Discard</button>
      </div>
    </div>
  );
}
