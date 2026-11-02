"use client";

import { useMemo, useState } from "react";
import { ImageIcon, Maximize2, Minimize2 } from "lucide-react";
import { buildSrcdoc, hasRemoteImages, MAIL_SANDBOX } from "@/lib/mail/html";
import { ab } from "../command/hud";

/**
 * A message body. HTML is shown in a sandboxed iframe (no scripts, opaque
 * origin, strict CSP; see src/lib/mail/html.ts) with remote images blocked
 * until "Show images". Plain text is shown as text.
 */
export function MailBody({ html, text }: { html: string | null; text: string }) {
  const [images, setImages] = useState(false);
  const [tall, setTall] = useState(false);
  const remote = useMemo(() => !!html && hasRemoteImages(html), [html]);
  const doc = useMemo(() => (html ? buildSrcdoc(html, { showImages: images }) : null), [html, images]);

  if (!doc) {
    return <pre className="whitespace-pre-wrap break-words px-4 py-5 font-sans text-[15px] leading-relaxed text-ink sm:px-6">{text || "(empty message)"}</pre>;
  }
  return (
    <div>
      <div className={`flex flex-wrap items-center justify-between gap-2 px-4 py-2 sm:px-6 ${remote && !images ? "bg-accent/10" : ""}`}>
        <span className="min-w-0 flex-1 basis-56 text-[13px] text-muted">{remote && !images ? "Remote images are blocked so the sender can't tell you opened this." : "Shown in a locked-down frame: scripts never run."}</span>
        <div className="flex gap-2">
          {remote && !images && <button type="button" className={`${ab} rounded-full`} onClick={() => setImages(true)}><ImageIcon size={14} />Show images</button>}
          <button type="button" className={`${ab} rounded-full`} onClick={() => setTall((t) => !t)} aria-label={tall ? "Shorter" : "Taller"}>{tall ? <Minimize2 size={14} /> : <Maximize2 size={14} />}{tall ? "Shorter" : "Taller"}</button>
        </div>
      </div>
      {/* The email itself always renders on white (as senders design it); in dark mode it sits in an inset white card. */}
      <div className="dark:p-3 sm:dark:p-4">
        <iframe
          key={images ? "img" : "noimg"}
          title="Message body"
          sandbox={MAIL_SANDBOX}
          srcDoc={doc}
          referrerPolicy="no-referrer"
          loading="lazy"
          className="block w-full border-0 bg-white dark:rounded-[12px]"
          style={{ height: tall ? "180vh" : "70vh", minHeight: 320 }}
        />
      </div>
    </div>
  );
}
