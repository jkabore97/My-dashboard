"use client";

import { useState, useTransition } from "react";
import { Mail, Printer } from "lucide-react";
import { emailWeeklyReport, sendBriefNow } from "@/app/actions/reports";
import { btn } from "@/components/ui";

const b = `${btn()} min-h-10 [--b:#ff5fd7]`;

export function ReportButtons({ business, to, email, brief }: { business: string; to: string; email: boolean; brief: boolean }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      <button className={b} onClick={() => window.print()}><Printer size={14} />Print / save as PDF</button>
      {email && <button className={b} disabled={pending} onClick={() => start(async () => setMsg(await emailWeeklyReport(business, to)))}><Mail size={14} />Email it to me</button>}
      {email && brief && <button className={`${btn("solid")} min-h-10`} disabled={pending} onClick={() => start(async () => setMsg(await sendBriefNow()))}><Mail size={14} />Send today&apos;s brief now</button>}
      {msg && <span role="status" className={`text-sm ${msg.error ? "text-critical" : "text-ok"}`}>{msg.error ?? msg.ok}</span>}
    </div>
  );
}
