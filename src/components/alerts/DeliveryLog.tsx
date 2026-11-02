import { Check } from "lucide-react";
import type { AlertEntry, AlertStatus } from "@/lib/server/alerts/store";
import { Empty, SeverityIcon, SYS, Tag, timeAgo } from "@/components/ui";
import { SEV_TEXT, SEV_WORD } from "@/components/command/hud";

// Red and orange stay reserved for problems: only a failed delivery uses red.
const STATUS_COLOR: Record<AlertStatus, string> = { sent: SYS.green, queued: SYS.blue, folded: SYS.indigo, suppressed: SYS.gray, failed: SYS.red };
const STATUS_WORD: Record<AlertStatus, string> = { sent: "Sent", queued: "Queued", folded: "Folded", suppressed: "Suppressed", failed: "Failed" };
const KIND_LABEL: Record<string, string> = { alert: "Alert", resolved: "Resolved", digest: "Summary", test: "Test" };

/** Who got which push, when, and why something wasn't sent. */
export function DeliveryLog({ rows, everyone, timeZone }: { rows: AlertEntry[]; everyone: boolean; timeZone: string }) {
  const counts = rows.reduce<Record<string, number>>((m, r) => ((m[r.status] = (m[r.status] ?? 0) + 1), m), {});
  return (
    <section id="delivery" className="mt-7 min-w-0 scroll-mt-24">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 px-1">
        <h2 className="text-[20px] font-bold tracking-[-0.01em] text-ink">Delivery log</h2>
        <span className="text-[13px] text-muted">
          {everyone ? "Everyone" : "Yours"} · last {rows.length}
          {counts.failed ? <> · <span className="font-semibold text-critical">{counts.failed} failed</span></> : null}
        </span>
      </div>
      <div className="overflow-hidden rounded-[14px] bg-panel shadow-[0_0_0_1px_var(--color-line)]">
        {rows.length === 0 ? <Empty>No pushes yet. Alerts you can see will be listed here with their delivery status.</Empty> : (
          <ul className="[&>li+li]:border-t [&>li+li]:border-line">
            {rows.map((r) => (
              <li key={r.id} className="flex items-start gap-3 px-4 py-3 sm:px-5">
                <span className="pt-px">{r.kind === "resolved" ? <span className="grid h-5 w-5 place-items-center rounded-full bg-ok"><Check size={13} strokeWidth={3} className="text-white" aria-hidden /></span> : <SeverityIcon severity={r.severity} size={20} />}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <div className="min-w-0 break-words text-[15px] leading-snug text-ink">{r.title}</div>
                    <span className="shrink-0 text-[13px] tabular-nums text-muted" title={r.createdAt}>
                      <span className="sm:hidden">{timeAgo(r.createdAt)}</span>
                      <span className="hidden sm:inline">{new Date(r.createdAt).toLocaleDateString("en-US", { timeZone, month: "short", day: "numeric" })}, {new Date(r.createdAt).toLocaleTimeString("en-US", { timeZone, hour: "numeric", minute: "2-digit" })}</span>
                    </span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted">
                    <span className="font-semibold" style={{ color: r.kind === "resolved" ? "var(--color-ok)" : SEV_TEXT[r.severity] }}>{r.kind === "resolved" ? "Resolved" : SEV_WORD[r.severity]}</span>
                    <span>{KIND_LABEL[r.kind] ?? r.kind}</span>
                    {everyone && <span className="min-w-0 max-w-full truncate">→ {r.userEmail}</span>}
                    {r.reason && <span className="min-w-0 max-w-full break-words">· {r.reason}</span>}
                    {r.status === "queued" && <span className="tabular-nums">· due {new Date(r.deliverAfter).toLocaleString("en-US", { timeZone, weekday: "short", hour: "numeric", minute: "2-digit" })}</span>}
                    {r.ackedAt && <span className="text-ok">· acknowledged</span>}
                  </div>
                  <div className="mt-1.5"><Tag color={STATUS_COLOR[r.status]}>{STATUS_WORD[r.status] ?? r.status}</Tag></div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
