"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import {
  Bell as BellIcon, BarChart3, Building2, Calendar, Camera, Check, CheckSquare, ChevronDown, Clock3, Code2, Database, DollarSign, FileText, Globe, Home,
  Inbox, LogOut, MessageCircle, MoreHorizontal, Plug, Receipt, Search, Server, Settings, ShieldCheck, Sun, Users, X, Link2, type LucideIcon,
} from "lucide-react";
import { pageActive, visibleNav } from "@/lib/nav";
import { signOut } from "@/app/actions/auth";
import { setBusinessFilter } from "@/app/actions/view";
import type { ClockZone } from "../Clocks";
import { Bell, type BellData } from "./Bell";

/** Icon and tile colour per page (Apple system colours; red/orange stay for problems). */
const PAGE_ICON: Record<string, [LucideIcon, string]> = {
  "/": [Home, "#007aff"], "/tasks": [CheckSquare, "#ff9500"], "/inbox": [Inbox, "#5856d6"], "/agenda": [Calendar, "#ff2d55"],
  "/notifications": [BellIcon, "#ff3b30"], "/ask": [MessageCircle, "#af52de"],
  "/money": [DollarSign, "#34c759"], "/spend": [Receipt, "#00c7be"], "/clients": [Users, "#30b0c7"], "/deadlines": [Clock3, "#ff9500"], "/reports": [FileText, "#5856d6"],
  "/websites": [Globe, "#007aff"], "/domains": [Link2, "#32ade6"], "/analytics": [BarChart3, "#af52de"], "/security": [ShieldCheck, "#34c759"],
  "/repos": [Code2, "#5856d6"], "/hosting": [Server, "#007aff"], "/databases": [Database, "#00c7be"],
  "/cameras": [Camera, "#a2845e"], "/solar": [Sun, "#ffcc00"],
  "/platforms": [Plug, "#8e8e93"], "/team": [Building2, "#8e8e93"], "/settings": [Settings, "#8e8e93"],
};

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
    return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(now);
  } catch {
    return "?";
  }
}

/** "Updated just now" / "Updated 3 min ago": when the platform data on screen was fetched. */
function updated(ms: number | null) {
  if (ms === null) return "Updating…";
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return "Updated just now";
  const m = Math.round(s / 60);
  if (m < 60) return `Updated ${m} min ago`;
  const h = Math.round(m / 60);
  return `Updated ${h} h ago`;
}

const initials = (name: string, email: string) => {
  const base = name && name !== email ? name : email.split("@")[0];
  const parts = base.replace(/[^a-z0-9 ]/gi, " ").trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
};

/** A small rounded-square icon tile for a page. */
function PageIcon({ href, size = 22 }: { href: string; size?: number }) {
  const [Icon, color] = PAGE_ICON[href] ?? [Globe, "#8e8e93"];
  return (
    <span aria-hidden className="grid shrink-0 place-items-center rounded-[6px] text-white" style={{ background: color, width: size, height: size }}>
      <Icon size={Math.round(size * 0.62)} strokeWidth={2.2} />
    </span>
  );
}

function Badge({ n, gray = false }: { n: number; gray?: boolean }) {
  return <span className={`ml-auto min-w-[20px] rounded-full px-1.5 text-center text-[12px] font-semibold leading-[20px] text-white ${gray ? "bg-low" : "bg-critical"}`}>{n > 99 ? "99+" : n}</span>;
}

export function Shell({ allowed, counts, clocks, email, name, role, businesses, business, externalAt, bell, children }: ShellProps) {
  const path = usePathname();
  const groups = useMemo(() => visibleNav(allowed), [allowed]);
  const now = useNow(15_000);
  const [palette, setPalette] = useState(false);
  const [more, setMore] = useState(false);
  const [bizSheet, setBizSheet] = useState(false);
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

  // Sheets close when the page changes.
  useEffect(() => {
    setMore(false);
    setBizSheet(false);
  }, [path]);

  const fresh = now === null ? null : now - externalAt;
  const badge = (href: string) => (href === "/notifications" ? bell.urgent ?? 0 : counts[href] ?? 0);
  const showBiz = businesses.length > 1 || !!business;
  const display = name && name !== email ? name : email;

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[260px_minmax(0,1fr)]">
      {/* Sidebar (desktop) */}
      <aside className="sticky top-0 z-40 hidden h-screen flex-col border-r border-line bg-chrome backdrop-blur-xl backdrop-saturate-150 print:!hidden lg:flex">
        <Link href="/" className="flex items-center gap-2.5 px-5 pb-3 pt-5 text-[15px] font-semibold text-ink">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/kaj-k.png" alt="" width={26} height={28} className="h-7 w-auto" />
          <span className="leading-tight">Kaj Command Center</span>
        </Link>
        <nav aria-label="Sections" className="no-scrollbar flex-1 overflow-y-auto px-3 pb-4">
          {groups.map((g, gi) => (
            <div key={g.id}>
              {gi > 0 && <div className="px-2.5 pb-1.5 pt-5 text-[11px] font-semibold uppercase tracking-[0.04em] text-muted">{g.label}</div>}
              <ul className={gi === 0 ? "pt-1" : ""}>
                {g.pages.map((p) => {
                  const active = pageActive(p.href, path);
                  const n = badge(p.href);
                  return (
                    <li key={p.href}>
                      <Link href={p.href} aria-current={active ? "page" : undefined}
                        className={`flex min-h-9 items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[14px] text-ink transition-colors ${active ? "bg-fill font-semibold" : "hover:bg-fill/60"}`}>
                        <PageIcon href={p.href} />
                        <span className="truncate">{p.label}</span>
                        {n > 0 && <Badge n={n} />}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
        <div ref={userMenuRef} className="relative border-t border-line p-3">
          <button onClick={() => setUserMenu((v) => !v)} aria-label="Account" aria-expanded={userMenu} className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-fill">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-b from-[#a1a1a6] to-[#86868b] text-[12px] font-semibold text-white">{initials(name, email)}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-medium text-ink">{display}</span>
              {role && <span className="block truncate text-[12px] text-muted">{role}</span>}
            </span>
            <ChevronDown size={15} className={`shrink-0 text-muted transition-transform ${userMenu ? "rotate-180" : ""}`} />
          </button>
          {userMenu && (
            <div className="absolute bottom-[calc(100%-4px)] left-3 right-3 z-50 overflow-hidden rounded-xl bg-panel shadow-[0_10px_40px_rgb(0_0_0/0.18),0_0_0_1px_var(--color-line)]">
              <div className="border-b border-line px-4 py-3">
                <div className="truncate text-[14px] font-medium" title={email}>{display}</div>
                {name !== email && <div className="truncate text-[12px] text-muted">{email}</div>}
                {role && <div className="mt-0.5 text-[12px] text-muted">{role}</div>}
              </div>
              {allowed.includes("/settings") && <Link href="/settings" onClick={() => setUserMenu(false)} className="flex items-center gap-2.5 px-4 py-2.5 text-[14px] hover:bg-fill"><Settings size={15} className="text-muted" />Settings</Link>}
              <form action={signOut}><button className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-[14px] text-critical hover:bg-fill"><LogOut size={15} />Sign out</button></form>
            </div>
          )}
        </div>
      </aside>

      <div className="min-w-0">
        {/* Toolbar */}
        <header className="sticky top-0 z-30 border-b border-line/0 bg-bg/80 pt-[env(safe-area-inset-top)] backdrop-blur-xl backdrop-saturate-150 print:hidden">
          <div className="mx-auto flex h-12 max-w-[1264px] items-center gap-2 px-4 sm:gap-3 lg:h-[60px] lg:px-8">
            {/* Phone/tablet: logo + business button */}
            <Link href="/" aria-label="Today" className="shrink-0 lg:hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/kaj-k.png" alt="" width={24} height={26} className="h-[26px] w-auto" />
            </Link>
            {showBiz && (
              <button onClick={() => setBizSheet(true)} className="flex min-h-9 min-w-0 items-center gap-1 rounded-full bg-fill px-3 text-[14px] font-medium text-ink lg:hidden" aria-label="Business filter">
                <span className="truncate">{business ? `Only ${business}` : "All businesses"}</span>
                <ChevronDown size={15} className="shrink-0 text-muted" />
              </button>
            )}
            {business && <ClearFilter business={business} />}

            {/* Desktop: segmented business filter */}
            {showBiz && <div className="hidden min-w-0 lg:block"><BusinessFilter businesses={businesses} business={business} /></div>}

            <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-3">
              <div className="hidden items-center gap-3 text-[12px] tabular-nums text-muted xl:flex" aria-label="Local times">
                {clocks.map((z) => <span key={z.timeZone}>{z.label} <span className="text-ink/80">{fmtTime(now, z.timeZone)}</span></span>)}
              </div>
              <span className="hidden text-[12px] text-muted lg:inline" title="When the platform data on screen was fetched">{updated(fresh)}</span>
              <button onClick={() => setPalette(true)} className="hidden h-9 w-56 items-center gap-2 rounded-[10px] bg-fill px-3 text-left text-[14px] text-muted transition-colors hover:bg-fill-2 lg:flex">
                <Search size={15} /> Search
                <span className="ml-auto text-[12px]">⌘K</span>
              </button>
              <button onClick={() => setPalette(true)} aria-label="Search" className="grid h-9 w-9 place-items-center rounded-full text-cyan transition-colors hover:bg-fill lg:hidden"><Search size={20} /></button>
              <Bell data={bell} />
            </div>
          </div>
        </header>

        <main className="mx-auto min-w-0 max-w-[1264px] px-4 pb-tabbar pt-3 sm:pt-4 lg:px-8 lg:pb-12 lg:pt-4">{children}</main>
      </div>

      {/* Tab bar (phone and tablet) */}
      <nav aria-label="Tabs" className="fixed inset-x-0 bottom-0 z-40 flex justify-around border-t border-line bg-chrome pb-[env(safe-area-inset-bottom)] backdrop-blur-xl backdrop-saturate-150 print:hidden lg:hidden">
        {[
          { href: "/", label: "Today", Icon: Home },
          { href: "/tasks", label: "Tasks", Icon: CheckSquare },
          { href: "/inbox", label: "Inbox", Icon: Inbox },
          { href: "/money", label: "Money", Icon: DollarSign },
        ].filter((i) => allowed.includes(i.href)).map(({ href, label, Icon }) => {
          const active = pageActive(href, path);
          return (
            <Link key={href} href={href} aria-current={active ? "page" : undefined} className={`flex min-h-[50px] min-w-16 flex-1 flex-col items-center justify-center gap-0.5 pt-1.5 text-[10.5px] font-medium ${active ? "text-cyan" : "text-low"}`}>
              <span className="relative"><Icon size={23} strokeWidth={active ? 2.2 : 1.8} />{counts[href] ? <span className="absolute -right-2 -top-1 min-w-[16px] rounded-full bg-critical px-1 text-center text-[10px] font-semibold leading-4 text-white">{counts[href]}</span> : null}</span>{label}
            </Link>
          );
        })}
        <button onClick={() => setMore(true)} className={`flex min-h-[50px] min-w-16 flex-1 flex-col items-center justify-center gap-0.5 pt-1.5 text-[10.5px] font-medium ${more ? "text-cyan" : "text-low"}`}><MoreHorizontal size={23} />More</button>
      </nav>

      {more && <MoreSheet groups={groups} badge={badge} onClose={() => setMore(false)} email={email} name={display} role={role} clocks={clocks} now={now} fresh={fresh} />}
      {bizSheet && <BusinessSheet businesses={businesses} business={business} onClose={() => setBizSheet(false)} />}
      {palette && <Palette groups={groups} businesses={businesses} onClose={() => setPalette(false)} />}
    </div>
  );
}

/** Desktop business filter: a segmented control for a few businesses, a pop-up menu for many. */
function BusinessFilter({ businesses, business }: { businesses: string[]; business: string | null }) {
  const [pending, start] = useTransition();
  const pick = (b: string | null) => start(() => setBusinessFilter(b));
  const options = business && !businesses.includes(business) ? [business, ...businesses] : businesses;
  const short = options.length <= 4 && options.join("").length <= 48;
  if (short) {
    return (
      <div role="radiogroup" aria-label="Business filter" className={`inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-[9px] bg-fill p-0.5 no-scrollbar ${pending ? "opacity-60" : ""}`}>
        {[null, ...options].map((b) => {
          const on = (b ?? null) === (business ?? null);
          return (
            <button key={b ?? "all"} role="radio" aria-checked={on} disabled={pending} onClick={() => !on && pick(b)}
              className={`whitespace-nowrap rounded-[7px] px-3.5 py-[5px] text-[13px] font-medium transition ${on ? "bg-panel text-ink shadow-[0_1px_3px_rgb(0_0_0/0.12)] dark:bg-[#636366]" : "text-ink/80 hover:text-ink"}`}>
              {b ?? "All"}
            </button>
          );
        })}
      </div>
    );
  }
  return (
    <select
      aria-label="Business filter"
      value={business ?? ""}
      disabled={pending}
      onChange={(e) => pick(e.target.value || null)}
      className="hud-input h-9 max-w-60 cursor-pointer bg-fill py-0 pl-3 text-[14px] font-medium"
    >
      <option value="">All businesses</option>
      {options.map((b) => <option key={b} value={b}>{b}</option>)}
    </select>
  );
}

/** Always-visible reminder (and the way out on phones) when one business is selected. */
function ClearFilter({ business }: { business: string }) {
  const [pending, start] = useTransition();
  return (
    <button onClick={() => start(() => setBusinessFilter(null))} disabled={pending} title="Show all businesses" aria-label={`Only ${business}: show all businesses`}
      className="hidden min-h-8 max-w-48 shrink-0 items-center gap-1.5 rounded-full bg-cyan/12 px-3 text-[13px] font-medium text-cyan lg:inline-flex">
      <span className="truncate">Only {business}</span><X size={13} className="shrink-0" />
    </button>
  );
}

/** iOS-style bottom sheet. */
function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 bg-black/35 lg:hidden" onClick={onClose}>
      <div role="dialog" aria-label={title} className="absolute inset-x-0 bottom-0 max-h-[88vh] overflow-y-auto rounded-t-[14px] bg-bg pb-[calc(env(safe-area-inset-bottom)+20px)] shadow-[0_-10px_40px_rgb(0_0_0/0.2)]" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 bg-bg/90 backdrop-blur-xl">
          <div className="mx-auto mt-1.5 h-[5px] w-9 rounded-full bg-low/40" aria-hidden />
          <div className="flex items-center justify-between px-4 pb-2 pt-2">
            <span className="text-[17px] font-semibold">{title}</span>
            <button onClick={onClose} className="min-h-9 px-1 text-[17px] font-semibold text-cyan">Done</button>
          </div>
        </div>
        <div className="grid gap-6 px-4 pt-2">{children}</div>
      </div>
    </div>
  );
}

function SheetGroup({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div>
      {label && <div className="mb-1.5 px-4 text-[13px] uppercase tracking-[0.02em] text-muted">{label}</div>}
      <div className="overflow-hidden rounded-[12px] bg-panel [&>*+*]:border-t [&>*+*]:border-line">{children}</div>
    </div>
  );
}

function BusinessSheet({ businesses, business, onClose }: { businesses: string[]; business: string | null; onClose: () => void }) {
  const [pending, start] = useTransition();
  const options = business && !businesses.includes(business) ? [business, ...businesses] : businesses;
  return (
    <Sheet title="Business" onClose={onClose}>
      <SheetGroup>
        {[null, ...options].map((b) => {
          const on = (b ?? null) === (business ?? null);
          return (
            <button key={b ?? "all"} disabled={pending} onClick={() => start(async () => { await setBusinessFilter(b); onClose(); })}
              className="flex min-h-12 w-full items-center justify-between px-4 text-left text-[17px] active:bg-fill">
              <span className="truncate">{b ?? "All businesses"}</span>
              {on && <Check size={20} className="shrink-0 text-cyan" />}
            </button>
          );
        })}
      </SheetGroup>
    </Sheet>
  );
}

function MoreSheet({ groups, badge, onClose, email, name, role, clocks, now, fresh }: { groups: ReturnType<typeof visibleNav>; badge: (href: string) => number; onClose: () => void; email: string; name: string; role: string | null; clocks: ClockZone[]; now: number | null; fresh: number | null }) {
  const tabs = new Set(["/", "/tasks", "/inbox", "/money"]);
  return (
    <Sheet title="More" onClose={onClose}>
      {groups.map((g) => {
        const pages = g.pages.filter((p) => !tabs.has(p.href));
        if (!pages.length) return null;
        return (
          <SheetGroup key={g.id} label={g.label}>
            {pages.map((p) => {
              const n = badge(p.href);
              return (
                <Link key={p.href} href={p.href} onClick={onClose} className="flex min-h-12 items-center gap-3 px-4 text-[17px] active:bg-fill">
                  <PageIcon href={p.href} size={29} />
                  <span className="min-w-0 flex-1 truncate">{p.label}</span>
                  {n > 0 && <Badge n={n} />}
                </Link>
              );
            })}
          </SheetGroup>
        );
      })}
      <SheetGroup label="Account">
        <div className="px-4 py-3">
          <div className="truncate text-[17px]">{name}</div>
          <div className="truncate text-[13px] text-muted">{name !== email ? `${email}${role ? ` · ${role}` : ""}` : role}</div>
        </div>
        <form action={signOut}><button className="flex min-h-12 w-full items-center gap-2 px-4 text-left text-[17px] text-critical active:bg-fill"><LogOut size={18} />Sign out</button></form>
      </SheetGroup>
      <p className="px-4 text-center text-[13px] text-muted">
        {clocks.map((z) => `${z.label} ${fmtTime(now, z.timeZone)}`).join(" · ")}{clocks.length ? " · " : ""}{updated(fresh)}
      </p>
    </Sheet>
  );
}

function Palette({ groups, businesses, onClose }: { groups: ReturnType<typeof visibleNav>; businesses: string[]; onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);
  const items = useMemo(() => {
    const pages = groups.flatMap((g) => g.pages.map((p) => ({ key: p.href, label: p.label, hint: g.label, href: p.href as string | null, run: () => router.push(p.href) })));
    const biz = [{ key: "biz:", label: "All businesses", hint: "Filter", href: null, run: () => void setBusinessFilter(null) },
      ...businesses.map((b) => ({ key: `biz:${b}`, label: b, hint: "Show only this business", href: null, run: () => void setBusinessFilter(b) }))];
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
    <div className="fixed inset-0 z-[60] bg-black/30 px-4 pt-[10vh] backdrop-blur-[2px]" onClick={onClose}>
      <div className="mx-auto max-w-xl overflow-hidden rounded-[14px] bg-panel shadow-[0_20px_60px_rgb(0_0_0/0.3),0_0_0_1px_var(--color-line)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
          <Search size={18} className="shrink-0 text-muted" />
          <input ref={inputRef} value={q} onChange={(e) => { setQ(e.target.value); setSel(0); }} placeholder="Jump to a page or business" className="w-full bg-transparent text-[17px] outline-none placeholder:text-muted"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, items.length - 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
              if (e.key === "Enter") choose(sel);
              if (e.key === "Escape") onClose();
            }} />
          <button onClick={onClose} className="shrink-0 text-[15px] text-cyan">Cancel</button>
        </div>
        <ul className="max-h-[55vh] overflow-y-auto p-1.5">
          {items.map((i, n) => (
            <li key={i.key}>
              <button onMouseEnter={() => setSel(n)} onClick={() => choose(n)} className={`flex min-h-10 w-full items-center gap-3 rounded-lg px-2.5 py-1.5 text-left text-[15px] ${n === sel ? "bg-cyan text-white" : ""}`}>
                {i.href ? <PageIcon href={i.href} /> : <span className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-[6px] bg-low text-white"><Building2 size={13} /></span>}
                <span className="flex-1 truncate">{i.label}</span>
                <span className={`text-[12px] ${n === sel ? "text-white/80" : "text-muted"}`}>{i.hint}</span>
              </button>
            </li>
          ))}
          {items.length === 0 && <li className="px-4 py-6 text-center text-[15px] text-muted">Nothing matches.</li>}
        </ul>
      </div>
    </div>
  );
}
