"use client";

import { useState, useTransition, type CSSProperties } from "react";
import { Wrench } from "lucide-react";
import { runFixAction } from "@/app/actions/assistant";

export function FixButton({ taskId, label, title }: { taskId: string; label: string; title: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        className="hud-btn hud-btn-solid min-h-10 px-3 py-1 text-[11.5px] sm:min-h-8"
        style={{ "--b": "#3df5a0" } as CSSProperties}
        disabled={pending}
        onClick={() => confirm(`${label}: "${title}"?\n\nThis acts on the live platform with your connected account.`) && start(async () => setMsg(await runFixAction(taskId)))}
      >
        <Wrench size={12} />
        {pending ? "Working…" : label}
      </button>
      {msg && <span className={`text-xs ${msg.error ? "text-critical" : "text-ok"}`}>{msg.error ?? msg.ok}</span>}
    </span>
  );
}
