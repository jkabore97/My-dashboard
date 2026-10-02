"use client";

import { useState } from "react";

export function RecoveryCodes({ codes }: { codes: string[] }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="hud-cut border border-gold/50 bg-gold/5 p-4">
      <p className="hud-label text-[12px] text-gold">Save these recovery codes now</p>
      <p className="mt-1 text-[13px] text-muted">They won&apos;t be shown again. Each one signs you in once if you lose your phone.</p>
      <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 font-mono text-sm tabular-nums text-ink">{codes.map((c) => <li key={c}>{c}</li>)}</ul>
      <button
        type="button"
        onClick={() => navigator.clipboard.writeText(codes.join("\n")).then(() => setCopied(true))}
        className="hud-btn mt-3 min-h-10"
      >
        {copied ? "Copied" : "Copy all"}
      </button>
    </div>
  );
}
