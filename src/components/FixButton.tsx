"use client";

import { useState, useTransition } from "react";
import { Wrench } from "lucide-react";
import { runFixAction } from "@/app/actions/assistant";

export function FixButton({ taskId, label, title }: { taskId: string; label: string; title: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        className="hud-btn hud-btn-solid min-h-9 rounded-full px-3.5 py-1 text-[13px] sm:min-h-8"
        disabled={pending}
        onClick={() => confirm(`${label}: "${title}"?\n\nThis acts on the live platform with your connected account.`) && start(async () => setMsg(await runFixAction(taskId)))}
      >
        <Wrench size={13} />
        {pending ? "Working…" : label}
      </button>
      {msg && <span className={`text-xs ${msg.error ? "text-critical" : "text-ok"}`}>{msg.error ?? msg.ok}</span>}
    </span>
  );
}
