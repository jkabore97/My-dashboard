import { Check } from "lucide-react";
import type { AlertEntry, AlertStatus } from "@/lib/server/alerts/store";
import { Card, Empty, SeverityIcon, Tag, timeAgo } from "@/components/ui";
import { SEV_COLOR, SEV_WORD } from "@/components/command/hud";

// Red and orange stay reserved for problems: only a failed delivery uses red.
const STATUS_COLOR: Record<AlertStatus, string> = { sent: "#3df5a0", queued: "#3fd0ff", folded: "#a98bff", suppressed: "#7f97ab", failed: "#ff3d6e" };
const KIND_LABEL: Record<string, string> = { alert: "Alert", resolved: "Resolved", digest: "Summary", test: "Test" };

/** Who got which push, when, and why something wasn't sent. */
export function DeliveryLog({ rows, everyone, timeZone }: { rows: AlertEntry[]; everyone: boolean; timeZone: string }) {
  const counts = rows.reduce<Record<string, number>>((m, r) => ((m[r.status] = (m[r.status] ?? 0) + 1), m), {});
  return (
    <div id="delivery" className="mt-4 scroll-mt-24 lg:mt-[22px]">
      <Card title="Delivery log" accent="violet" flush action={`${everyone ? "everyone" : "yours"} · last ${rows.length}${counts.failed ? ` · ${counts.failed} failed` : ""}`}>
        {rows.length === 0 ? <Empty>No pushes yet. Alerts you can see will be listed here with their delivery status.</Empty> : (
          <ul>
            {rows.map((r) => (
              <li key={r.id} className="grid grid-cols-[22px_minmax(0,1fr)] items-start gap-x-3 border-b border-line/40 px-4 py-3 last:border-0 sm:grid-cols-[76px_22px_minmax(0,1fr)_auto] sm:gap-x-4 sm:px-5">
                <div className="hidden font-mono text-[12px] leading-tight tabular-nums text-muted sm:block" title={r.createdAt}>
                  {new Date(r.createdAt).toLocaleTimeString("en-US", { timeZone, hour: "numeric", minute: "2-digit" })}
                  <div className="text-[10.5px]">{new Date(r.createdAt).toLocaleDateString("en-US", { timeZone, month: "short", day: "numeric" })}</div>
                </div>
                <span className="mt-0.5">{r.kind === "resolved" ? <Check size={18} className="text-emerald" aria-hidden /> : <SeverityIcon severity={r.severity} size={20} />}</span>
                <div className="min-w-0">
                  <div className="break-words text-[13.5px]">{r.title}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-muted">
                    <span className="hud-label text-[10.5px] font-bold" style={{ color: r.kind === "resolved" ? "#3df5a0" : SEV_COLOR[r.severity] }}>{r.kind === "resolved" ? "Resolved" : SEV_WORD[r.severity]}</span>
                    <span>{KIND_LABEL[r.kind] ?? r.kind}</span>
                    {everyone && <span className="min-w-0 max-w-full truncate">→ {r.userEmail}</span>}
                    {r.reason && <span className="min-w-0 max-w-full break-words">· {r.reason}</span>}
                    {r.status === "queued" && <span className="font-mono tabular-nums">· due {new Date(r.deliverAfter).toLocaleString("en-US", { timeZone, weekday: "short", hour: "numeric", minute: "2-digit" })}</span>}
                    {r.ackedAt && <span className="text-emerald">· acknowledged</span>}
                    <span className="font-mono tabular-nums sm:hidden">· {timeAgo(r.createdAt)}</span>
                  </div>
                </div>
                <span className="col-start-2 mt-1.5 sm:col-start-auto sm:mt-0"><Tag color={STATUS_COLOR[r.status]}>{r.status}</Tag></span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
