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
    return <pre className="whitespace-pre-wrap break-words px-4 py-4 font-sans text-[14px] leading-relaxed text-[#dfeaf3] sm:px-5">{text || "(empty message)"}</pre>;
  }
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line/60 px-4 py-2 sm:px-5">
        <span className="text-[12px] text-muted">{remote && !images ? "Remote images are blocked so the sender can't tell you opened this." : "Shown in a locked-down frame: scripts never run."}</span>
        <div className="flex gap-2">
          {remote && !images && <button type="button" className={ab} onClick={() => setImages(true)}><ImageIcon size={13} />Show images</button>}
          <button type="button" className={ab} onClick={() => setTall((t) => !t)} aria-label={tall ? "Shorter" : "Taller"}>{tall ? <Minimize2 size={13} /> : <Maximize2 size={13} />}{tall ? "Shorter" : "Taller"}</button>
        </div>
      </div>
      <iframe
        key={images ? "img" : "noimg"}
        title="Message body"
        sandbox={MAIL_SANDBOX}
        srcDoc={doc}
        referrerPolicy="no-referrer"
        loading="lazy"
        className="block w-full border-0 bg-white"
        style={{ height: tall ? "180vh" : "70vh", minHeight: 320 }}
      />
    </div>
  );
}
