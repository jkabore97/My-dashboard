"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Bell as BellIcon, Check, X } from "lucide-react";
import { alertEntryAction, markAllReadAction } from "@/app/actions/alerts";
import { SeverityIcon, timeAgo } from "@/components/ui";
import { SEV_COLOR, SEV_WORD } from "@/components/command/hud";
import type { Severity } from "@/lib/types";

export interface BellItem {
  id: string;
  taskId: string | null;
  kind: string;
  severity: Severity;
  title: string;
  body: string | null;
  url: string | null;
  status: string;
  reason: string | null;
  deliverAfter: string;
  createdAt: string;
  read: boolean;
  acked: boolean;
}

export interface BellData {
  unread: number;
  items: BellItem[];
}

const when = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

/** Top-bar bell: unread count and the latest notifications, with Open / Acknowledge. */
export function Bell({ data }: { data: BellData }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(data.items);
  const [unread, setUnread] = useState(data.unread);
  const [pending, start] = useTransition();
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setItems(data.items);
    setUnread(data.unread);
  }, [data]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !panel.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const markLocal = (id: string | null, patch: Partial<BellItem>) => {
    setItems((list) => list.map((i) => (id === null || i.id === id || (patch.acked && i.taskId && i.taskId === list.find((x) => x.id === id)?.taskId) ? { ...i, ...patch } : i)));
  };
  const openItem = (i: BellItem) => {
    if (!i.read && i.status !== "queued") {
      setUnread((n) => Math.max(0, n - 1));
      markLocal(i.id, { read: true });
      start(async () => void (await alertEntryAction(i.id, "read")));
    }
    setOpen(false);
    router.push(i.url && i.url.startsWith("/") ? i.url : "/tasks");
  };
  const ack = (i: BellItem) =>
    start(async () => {
      const r = await alertEntryAction(i.id, "ack");
      if (r.error) return;
      const sameTask = items.filter((x) => x.taskId === i.taskId && !x.read && x.status !== "queued").length;
      setUnread((n) => Math.max(0, n - sameTask));
      markLocal(i.id, { acked: true, read: true });
    });
  const readAll = () =>
    start(async () => {
      await markAllReadAction();
      setUnread(0);
      markLocal(null, { read: true });
    });

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={open}
        className="hud-cut relative grid h-9 w-9 shrink-0 place-items-center sm:h-10 sm:w-10 text-muted transition hover:text-ink"
        style={open ? { color: "#ff5fd7", background: "rgb(255 95 215 / .1)" } : undefined}
      >
        <BellIcon size={19} strokeWidth={1.8} />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 min-w-[18px] border border-critical bg-[#2a0712] px-1 text-center font-mono text-[10.5px] font-semibold leading-[16px] text-critical shadow-[0_0_8px_rgba(255,61,110,.5)]">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {/* Portalled: the top bar's backdrop blur would otherwise trap a fixed panel inside it. */}
      {open && createPortal(
        // .hud-panel sets position: relative, so the fixed placement lives on this wrapper.
        <div ref={panel} className="fixed inset-x-3 top-[62px] z-50 sm:inset-x-auto sm:right-6 sm:top-[70px] sm:w-[400px]" role="dialog" aria-label="Notifications">
        <div className="hud-panel max-h-[75vh] overflow-hidden shadow-2xl" style={{ "--a": "#ff5fd7", background: "#081320" } as CSSProperties}>
          <header className="hud-head flex items-center justify-between gap-2 px-4 py-3">
            <h2 className="hud-title text-[13px]">Notifications{unread ? <span className="ml-2 font-mono text-[11px] text-critical">{unread} new</span> : null}</h2>
            <div className="flex items-center gap-1">
              {unread > 0 && <button onClick={readAll} disabled={pending} className="hud-label px-2 py-1 text-[11px] text-cyan hover:underline">Mark all read</button>}
              <button onClick={() => setOpen(false)} aria-label="Close" className="p-1 text-muted hover:text-ink"><X size={16} /></button>
            </div>
          </header>
          <ul className="max-h-[calc(75vh-96px)] overflow-y-auto">
            {items.length === 0 && <li className="px-4 py-8 text-center text-sm text-muted">Nothing yet. Alerts you can see will show up here.</li>}
            {items.map((i) => {
              const resolved = i.kind === "resolved";
              const unreadItem = !i.read && i.status !== "queued";
              return (
                <li key={i.id} className={`grid grid-cols-[22px_minmax(0,1fr)] gap-x-3 border-b border-line/40 px-4 py-3 last:border-0 ${unreadItem ? "bg-cyan/[0.04]" : ""}`}>
                  <span className="mt-0.5">{resolved ? <Check size={18} className="text-emerald" aria-hidden /> : <SeverityIcon severity={i.severity} size={20} />}</span>
                  <div className="min-w-0">
                    <div className="flex items-start gap-2">
                      <span className={`min-w-0 flex-1 break-words text-[13.5px] leading-snug ${unreadItem ? "text-ink" : "text-[#c5d3de]"}`}>{i.title}</span>
                      {unreadItem && <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan shadow-[0_0_6px_#3fd0ff]" aria-label="unread" />}
                    </div>
                    {i.body && <div className="mt-0.5 line-clamp-2 break-words text-[12px] text-muted">{i.body}</div>}
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11.5px] text-muted">
                      <span className="hud-label text-[10.5px] font-bold" style={{ color: resolved ? "#3df5a0" : SEV_COLOR[i.severity] }}>{resolved ? "Resolved" : SEV_WORD[i.severity]}</span>
                      <span className="font-mono tabular-nums">{i.status === "queued" ? `due ${when(i.deliverAfter)}` : timeAgo(i.createdAt)}</span>
                      {i.status === "queued" && <span title={i.reason ?? undefined}>{i.reason === "noon digest" ? "in noon digest" : `held: ${i.reason ?? "quiet hours"}`}</span>}
                      {i.status === "failed" && <span title={i.reason ?? undefined}>not pushed</span>}
                      {i.acked && <span className="text-emerald">acknowledged</span>}
                      <span className="ml-auto flex items-center gap-1">
                        <button onClick={() => openItem(i)} className="hud-label min-h-8 px-2 text-[11px] text-cyan hover:underline">Open</button>
                        {!resolved && i.taskId && !i.acked && <button onClick={() => ack(i)} disabled={pending} className="hud-label min-h-8 px-2 text-[11px] text-cyan hover:underline">Acknowledge</button>}
                      </span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          <Link href="/settings#notifications" onClick={() => setOpen(false)} className="hud-label block border-t border-line/60 px-4 py-2.5 text-center text-[11px] text-muted hover:text-cyan">Notification settings</Link>
        </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
