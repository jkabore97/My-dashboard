"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { Bell as BellIcon, Check, X } from "lucide-react";
import { alertEntryAction, markAllReadAction } from "@/app/actions/alerts";
import { SeverityIcon, timeAgo } from "@/components/ui";
import { SEV_TEXT, SEV_WORD } from "@/components/command/hud";
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
  /** Unread critical and high alerts: the app icon badge. */
  urgent?: number;
  items: BellItem[];
}

const urgentItem = (i: BellItem) => i.kind === "alert" && (i.severity === "critical" || i.severity === "high") && !i.read && i.status !== "queued";

/** Sets the installed app's icon badge where the Badging API exists (Android/desktop PWAs); silent elsewhere. */
function setAppBadge(n: number) {
  try {
    const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    if (n > 0) nav.setAppBadge?.(Math.min(n, 99)).catch(() => {});
    else nav.clearAppBadge?.().catch(() => {});
  } catch {
    // not supported
  }
}

const when = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

/** Top-bar bell: unread count and the latest notifications, with Open / Acknowledge. */
export function Bell({ data }: { data: BellData }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(data.items);
  const [unread, setUnread] = useState(data.unread);
  const [urgent, setUrgent] = useState(data.urgent ?? 0);
  const [pending, start] = useTransition();
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setItems(data.items);
    setUnread(data.unread);
    setUrgent(data.urgent ?? 0);
  }, [data]);

  useEffect(() => setAppBadge(urgent), [urgent]);

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
      if (urgentItem(i)) setUrgent((n) => Math.max(0, n - 1));
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
      const sameTask = items.filter((x) => x.taskId === i.taskId && !x.read && x.status !== "queued");
      setUnread((n) => Math.max(0, n - sameTask.length));
      setUrgent((n) => Math.max(0, n - sameTask.filter(urgentItem).length));
      markLocal(i.id, { acked: true, read: true });
    });
  const readAll = () =>
    start(async () => {
      await markAllReadAction();
      setUnread(0);
      setUrgent(0);
      markLocal(null, { read: true });
    });

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={open}
        className={`relative grid h-9 w-9 shrink-0 place-items-center rounded-full text-cyan transition-colors hover:bg-fill ${open ? "bg-fill" : ""}`}
      >
        <BellIcon size={20} strokeWidth={1.9} />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-critical px-1 text-center text-[11px] font-semibold leading-[18px] text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {/* Portalled: the top bar's backdrop blur would otherwise trap a fixed panel inside it. */}
      {open && createPortal(
        <div ref={panel} className="fixed inset-x-3 top-[calc(env(safe-area-inset-top)+54px)] z-50 sm:inset-x-auto sm:right-6 lg:top-[64px] sm:w-[400px]" role="dialog" aria-label="Notifications">
        <div className="max-h-[75vh] overflow-hidden rounded-[14px] bg-panel shadow-[0_20px_60px_rgb(0_0_0/0.22),0_0_0_1px_var(--color-line)]">
          <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
            <h2 className="text-[17px] font-semibold">Notifications{unread ? <span className="ml-2 text-[13px] font-medium text-critical">{unread} new</span> : null}</h2>
            <div className="flex items-center gap-1">
              {unread > 0 && <button onClick={readAll} disabled={pending} className="px-2 py-1 text-[14px] text-cyan hover:opacity-70">Mark all read</button>}
              <button onClick={() => setOpen(false)} aria-label="Close" className="grid h-7 w-7 place-items-center rounded-full bg-fill text-muted hover:text-ink"><X size={15} /></button>
            </div>
          </header>
          <ul className="max-h-[calc(75vh-96px)] overflow-y-auto">
            {items.length === 0 && <li className="px-4 py-8 text-center text-[15px] text-muted">Nothing yet. Alerts you can see will show up here.</li>}
            {items.map((i) => {
              const resolved = i.kind === "resolved";
              const unreadItem = !i.read && i.status !== "queued";
              return (
                <li key={i.id} className={`grid grid-cols-[22px_minmax(0,1fr)] gap-x-3 border-b border-line px-4 py-3 last:border-0 ${unreadItem ? "bg-cyan/[0.05]" : ""}`}>
                  <span className="mt-0.5">{resolved ? <Check size={18} className="text-emerald" aria-hidden /> : <SeverityIcon severity={i.severity} size={20} />}</span>
                  <div className="min-w-0">
                    <div className="flex items-start gap-2">
                      <span className={`min-w-0 flex-1 break-words text-[15px] leading-snug text-ink ${unreadItem ? "font-semibold" : ""}`}>{i.title}</span>
                      {unreadItem && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-cyan" aria-label="unread" />}
                    </div>
                    {i.body && <div className="mt-0.5 line-clamp-2 break-words text-[13px] text-muted">{i.body}</div>}
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12.5px] text-muted">
                      <span className="font-semibold" style={{ color: resolved ? "var(--color-ok)" : SEV_TEXT[i.severity] }}>{resolved ? "Resolved" : SEV_WORD[i.severity]}</span>
                      <span className="tabular-nums">{i.status === "queued" ? `due ${when(i.deliverAfter)}` : timeAgo(i.createdAt)}</span>
                      {i.status === "queued" && <span title={i.reason ?? undefined}>{i.reason === "noon digest" ? "in noon digest" : `held: ${i.reason ?? "quiet hours"}`}</span>}
                      {i.status === "failed" && <span title={i.reason ?? undefined}>not pushed</span>}
                      {i.acked && <span className="text-ok">Acknowledged</span>}
                      <span className="ml-auto flex items-center gap-1">
                        <button onClick={() => openItem(i)} className="min-h-8 px-2 text-[14px] font-medium text-cyan hover:opacity-70">Open</button>
                        {!resolved && i.taskId && !i.acked && <button onClick={() => ack(i)} disabled={pending} className="min-h-8 px-2 text-[14px] font-medium text-cyan hover:opacity-70">Acknowledge</button>}
                      </span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          <Link href="/settings#notifications" onClick={() => setOpen(false)} className="block border-t border-line px-4 py-3 text-center text-[14px] text-cyan hover:opacity-70">Notification settings</Link>
        </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
