"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition, type CSSProperties, type ReactNode } from "react";
import { Cctv, Code2, Crosshair, DollarSign, Globe, LogOut, MoreHorizontal, Search, Settings2, UserRound, X, CheckSquare, Mail, type LucideIcon } from "lucide-react";
import { groupFor, pageActive, visibleNav } from "@/lib/nav";
import { signOut } from "@/app/actions/auth";
import { setBusinessFilter } from "@/app/actions/view";
import type { ClockZone } from "../Clocks";
import { Bell, type BellData } from "./Bell";

const GROUP_ICON: Record<string, LucideIcon> = { core: Crosshair, money: DollarSign, web: Globe, build: Code2, sites: Cctv, admin: Settings2 };

export interface ShellProps {
  allowed: string[];
  counts: Record<string, number>;
  clocks: ClockZone[];
  email: string;
  name: string;
  role: string | null;
  businesses: string[];
  business: string | null;
  externalAt: number;
  bell: BellData;
  children: ReactNode;
}

function useNow(intervalMs: number) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

function fmtTime(now: number | null, timeZone: string) {
  if (now === null) return "--:--";
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit" }).format(now);
  } catch {
    return "?";
  }
}

function ago(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return "now";
  const m = Math.round(s / 60);
  return m < 60 ? `${m}m ago` : `${Math.round(m / 60)}h ago`;
}

export function Shell({ allowed, counts, clocks, email, name, role, businesses, business, externalAt, bell, children }: ShellProps) {
  const path = usePathname();
  const groups = useMemo(() => visibleNav(allowed), [allowed]);
  const group = groupFor(path);
  const current = groups.find((g) => g.id === group.id);
  const now = useNow(15_000);
  const [palette, setPalette] = useState(false);
  const [more, setMore] = useState(false);
  const [userMenu, setUserMenu] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  // The account menu closes on a click elsewhere or Escape.
  useEffect(() => {
    if (!userMenu) return;
    const onDown = (e: MouseEvent) => {
      if (!userMenuRef.current?.contains(e.target as Node)) setUserMenu(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setUserMenu(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [userMenu]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const groupCount = (id: string) => groups.find((g) => g.id === id)?.pages.reduce((n, p) => n + (counts[p.href] ?? 0), 0) ?? 0;
  const fresh = now === null ? null : now - externalAt;

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[76px_minmax(0,1fr)]" style={{ "--ga": group.color } as CSSProperties}>
      {/* Rail (desktop) */}
      <aside className="sticky top-0 z-40 hidden h-screen flex-col items-center gap-2 border-r border-line/60 bg-gradient-to-b from-[#081420]/90 to-[#04080e]/90 py-4 print:!hidden lg:flex">
        <Link href="/" aria-label="Overview" className="mb-3 grid h-11 w-11 place-items-center rounded-full border-[1.5px] border-violet font-display font-bold text-cyan shadow-[0_0_16px_rgba(169,139,255,.45),inset_0_0_10px_rgba(63,208,255,.3)]">K</Link>
        {groups.map((g) => {
          const Icon = GROUP_ICON[g.id] ?? Crosshair;
          const active = g.id === group.id;
          const n = groupCount(g.id);
          return (
            <Link key={g.id} href={g.pages[0].href} title={g.label} aria-label={g.label}
              className="hud-cut relative grid h-12 w-12 place-items-center transition"
              style={active ? { color: g.color, background: `color-mix(in srgb, ${g.color} 14%, transparent)`, boxShadow: `inset 2px 0 0 ${g.color}` } : { color: "#7f97ab" }}>
              <Icon size={20} strokeWidth={1.8} />
              {n > 0 && <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-critical shadow-[0_0_6px_#ff3d6e]" />}
            </Link>
          );
        })}
        <div ref={userMenuRef} className="relative mt-auto">
          <button onClick={() => setUserMenu((v) => !v)} aria-label="Account" aria-expanded={userMenu} className="hud-cut grid h-12 w-12 place-items-center text-muted hover:text-ink"><UserRound size={20} strokeWidth={1.8} /></button>
          {userMenu && (
            <div className="absolute bottom-0 left-14 z-50 w-64 border border-line bg-panel p-4 shadow-2xl">
              <div className="truncate text-sm" title={email}>{name !== email ? name : email}</div>
              {name !== email && <div className="truncate text-xs text-muted">{email}</div>}
              {role && <div className="hud-label mt-1 text-[10px] text-muted">{role}</div>}
              <form action={signOut}><button className="hud-btn mt-3 w-full"><LogOut size={12} /> Sign out</button></form>
            </div>
          )}
        </div>
      </aside>

      <div className="min-w-0">
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line/60 bg-bg/80 px-4 backdrop-blur print:hidden sm:h-16 sm:gap-5 sm:px-6">
          <Link href="/" className="shrink-0 whitespace-nowrap bg-gradient-to-r from-cyan via-violet to-pink bg-clip-text font-display text-sm font-bold tracking-[0.22em] text-transparent sm:text-base">
            KAJ <span className="hidden sm:inline">// COMMAND</span><span className="sm:hidden">// CMD</span>
          </Link>
          {(businesses.length > 1 || business) && <BusinessSelect businesses={businesses} business={business} />}
          {business && <ClearFilter business={business} />}
          <button onClick={() => setPalette(true)} className="hud-input hidden max-w-md flex-1 items-center gap-2 px-3 py-2 text-left text-sm text-muted md:flex">
            <span className="font-display font-bold text-cyan">&gt;</span> Jump to anything…
            <span className="ml-auto border border-line px-1.5 font-mono text-[10px]">⌘K</span>
          </button>
          <div className="ml-auto flex items-center gap-3 sm:gap-6">
            {clocks.map((z) => (
              <div key={z.timeZone} className="leading-tight">
                <div className="hud-label text-[9px] text-muted sm:text-[10px]">{z.label}</div>
                <div className="font-mono text-sm font-medium tabular-nums sm:text-base">{fmtTime(now, z.timeZone)}</div>
              </div>
            ))}
            <div className="hidden items-center gap-2 font-display text-[11px] tracking-[0.14em] text-cyan sm:flex" title="When the platform data on screen was fetched">
              <span className="h-2 w-2 rounded-full bg-cyan shadow-[0_0_10px_#3fd0ff]" />LIVE · {fresh === null ? "…" : ago(fresh)}
            </div>
            <Bell data={bell} />
          </div>
        </header>

        {/* Sub-navigation for the current group */}
        {current && current.pages.length > 1 && (
          <nav className="no-scrollbar flex gap-1 overflow-x-auto border-b border-line/60 px-2 print:hidden sm:px-6">
            {current.pages.map((p) => {
              const active = pageActive(p.href, path);
              const n = counts[p.href];
              return (
                <Link key={p.href} href={p.href} className="relative whitespace-nowrap px-3 py-3 font-display text-[12px] font-semibold uppercase tracking-[0.14em] transition"
                  style={active ? { color: group.color, textShadow: `0 0 10px ${group.color}99` } : { color: "#7f97ab" }}>
                  {p.label}
                  {n ? <span className="ml-1.5 border border-critical px-1 font-mono text-[10px] text-critical">{n}</span> : null}
                  {active && <span className="absolute inset-x-2 bottom-0 h-0.5" style={{ background: group.color, boxShadow: `0 0 8px ${group.color}` }} />}
                </Link>
              );
            })}
          </nav>
        )}

        <main className="min-w-0 px-4 pb-28 pt-5 sm:px-6 lg:pb-10">{children}</main>
      </div>

      {/* Phone bar */}
      <nav className="hud-cut fixed inset-x-3 bottom-3 z-40 flex justify-around border border-cyan/40 bg-[#060e16]/95 px-1 py-2 shadow-[0_0_30px_rgba(63,208,255,.15)] backdrop-blur print:hidden lg:hidden">
        {[
          { href: "/", label: "Core", Icon: Crosshair },
          { href: "/tasks", label: "Tasks", Icon: CheckSquare },
          { href: "/inbox", label: "Inbox", Icon: Mail },
          { href: "/money", label: "Money", Icon: DollarSign },
        ].filter((i) => allowed.includes(i.href)).map(({ href, label, Icon }) => {
          const active = href === "/" ? path === "/" : pageActive(href, path) || (href === "/money" && group.id === "money");
          return (
            <Link key={href} href={href} className="flex min-w-14 flex-col items-center gap-0.5 px-2 py-1 font-display text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ color: active ? "#3fd0ff" : "#7f97ab", textShadow: active ? "0 0 8px rgba(63,208,255,.6)" : undefined }}>
              <span className="relative"><Icon size={20} strokeWidth={1.8} />{counts[href] ? <span className="absolute -right-1.5 -top-1 h-2 w-2 rounded-full bg-critical" /> : null}</span>{label}
            </Link>
          );
        })}
        <button onClick={() => setMore(true)} className="flex min-w-14 flex-col items-center gap-0.5 px-2 py-1 font-display text-[10px] font-semibold uppercase tracking-[0.12em] text-muted"><MoreHorizontal size={20} />More</button>
      </nav>

      {more && <MoreSheet groups={groups} counts={counts} onClose={() => setMore(false)} email={email} businesses={businesses} business={business} />}
      {palette && <Palette groups={groups} businesses={businesses} onClose={() => setPalette(false)} />}
    </div>
  );
}

function BusinessSelect({ businesses, business, phone = false }: { businesses: string[]; business: string | null; phone?: boolean }) {
  const [pending, start] = useTransition();
  return (
    <select
      aria-label="Business filter"
      value={business ?? ""}
      disabled={pending}
      onChange={(e) => start(() => setBusinessFilter(e.target.value || null))}
      className={`hud-input cursor-pointer appearance-none px-3 py-2 font-display text-[12px] font-semibold uppercase tracking-[0.12em] ${phone ? "block w-full min-h-11" : "hidden max-w-48 sm:block"}`}
    >
      <option value="">All businesses ▾</option>
      {business && !businesses.includes(business) && <option value={business}>{business}</option>}
      {businesses.map((b) => <option key={b} value={b}>{b}</option>)}
    </select>
  );
}

/** Always-visible reminder (and the way out on phones) when one business is selected. */
function ClearFilter({ business }: { business: string }) {
  const [pending, start] = useTransition();
  return (
    <button onClick={() => start(() => setBusinessFilter(null))} disabled={pending} title="Show all businesses"
      className="hud-cut inline-flex min-h-9 max-w-40 items-center gap-1.5 border border-gold/60 bg-gold/10 px-2 font-display text-[11px] font-semibold uppercase tracking-[0.1em] text-gold sm:hidden">
      <span className="truncate">Only {business}</span><X size={12} className="shrink-0" />
    </button>
  );
}

function MoreSheet({ groups, counts, onClose, email, businesses, business }: { groups: ReturnType<typeof visibleNav>; counts: Record<string, number>; onClose: () => void; email: string; businesses: string[]; business: string | null }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm lg:hidden" onClick={onClose}>
      <div className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto border-t border-cyan/40 bg-[#07101b] p-5 pb-10" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <span className="hud-title text-sm">All sections</span>
          <button onClick={onClose} aria-label="Close" className="p-1 text-muted"><X size={20} /></button>
        </div>
        {businesses.length > 1 && (
          <div className="mb-4">
            <div className="hud-label mb-2 text-[11px] text-gold">Business</div>
            <BusinessSelect businesses={businesses} business={business} phone />
          </div>
        )}
        {groups.map((g) => (
          <div key={g.id} className="mb-4">
            <div className="hud-label mb-2 text-[11px]" style={{ color: g.color }}>{g.label}</div>
            <div className="grid grid-cols-2 gap-2">
              {g.pages.map((p) => (
                <Link key={p.href} href={p.href} onClick={onClose} className="hud-cut flex items-center justify-between border border-line bg-panel/70 px-3 py-2.5 text-sm">
                  {p.label}{counts[p.href] ? <span className="font-mono text-xs text-critical">{counts[p.href]}</span> : null}
                </Link>
              ))}
            </div>
          </div>
        ))}
        <div className="mt-2 flex items-center justify-between border-t border-line pt-4 text-xs text-muted">
          <span className="truncate">{email}</span>
          <form action={signOut}><button className="hud-btn"><LogOut size={12} /> Sign out</button></form>
        </div>
      </div>
    </div>
  );
}

function Palette({ groups, businesses, onClose }: { groups: ReturnType<typeof visibleNav>; businesses: string[]; onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);
  const items = useMemo(() => {
    const pages = groups.flatMap((g) => g.pages.map((p) => ({ key: p.href, label: p.label, hint: g.label, color: g.color, run: () => router.push(p.href) })));
    const biz = [{ key: "biz:", label: "All businesses", hint: "Filter", color: "#7f97ab", run: () => void setBusinessFilter(null) },
      ...businesses.map((b) => ({ key: `biz:${b}`, label: b, hint: "Show only this business", color: "#7f97ab", run: () => void setBusinessFilter(b) }))];
    const all = [...pages, ...biz];
    const s = q.trim().toLowerCase();
    return s ? all.filter((i) => i.label.toLowerCase().includes(s) || i.hint.toLowerCase().includes(s)) : all;
  }, [q, groups, businesses, router]);
  const choose = (i: number) => {
    const item = items[i];
    if (!item) return;
    onClose();
    item.run();
  };
  return (
    <div className="fixed inset-0 z-[60] bg-black/70 px-4 pt-[12vh] backdrop-blur-sm" onClick={onClose}>
      <div className="hud-panel mx-auto max-w-xl bg-[#081320]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <Search size={16} className="text-cyan" />
          <input ref={inputRef} value={q} onChange={(e) => { setQ(e.target.value); setSel(0); }} placeholder="Jump to a page or business…" className="w-full bg-transparent text-sm outline-none placeholder:text-muted"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, items.length - 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
              if (e.key === "Enter") choose(sel);
              if (e.key === "Escape") onClose();
            }} />
          <span className="border border-line px-1.5 font-mono text-[10px] text-muted">ESC</span>
        </div>
        <ul className="max-h-[50vh] overflow-y-auto py-1">
          {items.map((i, n) => (
            <li key={i.key}>
              <button onMouseEnter={() => setSel(n)} onClick={() => choose(n)} className={`flex w-full items-center gap-3 px-4 py-2 text-left text-sm ${n === sel ? "bg-cyan/10" : ""}`}>
                <span className="h-1.5 w-1.5 shrink-0" style={{ background: i.color, boxShadow: `0 0 6px ${i.color}` }} />
                <span className="flex-1">{i.label}</span>
                <span className="hud-label text-[10px] text-muted">{i.hint}</span>
              </button>
            </li>
          ))}
          {items.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted">Nothing matches.</li>}
        </ul>
      </div>
    </div>
  );
}
