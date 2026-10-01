"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Bell, CheckSquare, Database, Globe, LayoutDashboard, Mail, Menu, Plug, Server, GitBranch, X } from "lucide-react";

const NAV = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/tasks", label: "To-do", icon: CheckSquare },
  { href: "/inbox", label: "Inbox", icon: Mail },
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/websites", label: "Websites & users", icon: Globe },
  { href: "/repos", label: "Repositories", icon: GitBranch },
  { href: "/hosting", label: "Hosting", icon: Server },
  { href: "/databases", label: "Databases", icon: Database },
  { href: "/platforms", label: "Platforms", icon: Plug },
];

export function Sidebar({ counts }: { counts: Record<string, number> }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);

  const nav = (
    <nav className="flex flex-col gap-0.5">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? path === "/" : path.startsWith(href);
        const count = counts[href];
        return (
          <Link
            key={href}
            href={href}
            onClick={() => setOpen(false)}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${active ? "bg-panel-2 text-ink" : "text-muted hover:bg-panel-2/60 hover:text-ink"}`}
          >
            <Icon size={16} />
            <span className="flex-1">{label}</span>
            {count ? <span className="rounded-full bg-critical/20 px-1.5 text-[11px] font-semibold text-critical">{count}</span> : null}
          </Link>
        );
      })}
    </nav>
  );

  const brand = (
    <div className="mb-6 px-3">
      <div className="text-xs uppercase tracking-[0.2em] text-muted">Kaj Consulting</div>
      <div className="text-lg font-semibold">Command Center</div>
    </div>
  );

  return (
    <>
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-bg/90 px-4 py-3 backdrop-blur lg:hidden">
        <span className="font-semibold">Command Center</span>
        <button aria-label="Open menu" onClick={() => setOpen(true)} className="rounded-md p-1.5 hover:bg-panel-2"><Menu size={20} /></button>
      </div>
      {open && (
        <div className="fixed inset-0 z-40 bg-black/60 lg:hidden" onClick={() => setOpen(false)}>
          <aside className="h-full w-72 border-r border-line bg-panel p-4" onClick={(e) => e.stopPropagation()}>
            <button aria-label="Close menu" onClick={() => setOpen(false)} className="mb-2 ml-auto block rounded-md p-1.5 hover:bg-panel-2"><X size={18} /></button>
            {brand}
            {nav}
          </aside>
        </div>
      )}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 border-r border-line bg-panel p-4 lg:block">
        {brand}
        {nav}
      </aside>
    </>
  );
}
