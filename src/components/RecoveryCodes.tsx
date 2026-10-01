"use client";

import { useState } from "react";

export function RecoveryCodes({ codes }: { codes: string[] }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-lg border border-high/40 bg-high/10 p-4">
      <p className="text-sm font-medium">Save these recovery codes now. They won&apos;t be shown again.</p>
      <p className="mt-1 text-xs text-muted">Each one signs you in once if you lose your phone.</p>
      <ul className="mt-3 grid grid-cols-2 gap-1 font-mono text-sm">{codes.map((c) => <li key={c}>{c}</li>)}</ul>
      <button
        type="button"
        onClick={() => navigator.clipboard.writeText(codes.join("\n")).then(() => setCopied(true))}
        className="mt-3 rounded-lg border border-line px-3 py-1.5 text-xs hover:border-accent/50"
      >
        {copied ? "Copied" : "Copy all"}
      </button>
    </div>
  );
}
