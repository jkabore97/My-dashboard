"use client";

import { useState, useTransition } from "react";
import { Mail, Printer } from "lucide-react";
import { emailWeeklyReport, sendBriefNow } from "@/app/actions/reports";

const btn = "inline-flex items-center gap-2 rounded-lg border border-line px-3 py-1.5 text-sm text-muted hover:border-accent/50 hover:text-ink disabled:opacity-50";

export function ReportButtons({ business, to, email, brief }: { business: string; to: string; email: boolean; brief: boolean }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      <button className={btn} onClick={() => window.print()}><Printer size={14} />Print / save as PDF</button>
      {email && <button className={btn} disabled={pending} onClick={() => start(async () => setMsg(await emailWeeklyReport(business, to)))}><Mail size={14} />Email it to me</button>}
      {email && brief && <button className={btn} disabled={pending} onClick={() => start(async () => setMsg(await sendBriefNow()))}><Mail size={14} />Send today&apos;s brief now</button>}
      {msg && <span className={`text-sm ${msg.error ? "text-critical" : "text-ok"}`}>{msg.error ?? msg.ok}</span>}
    </div>
  );
}
