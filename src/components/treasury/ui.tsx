import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { BigNum, SeverityIcon, businessColor } from "@/components/ui";

// Building blocks shared by the Treasury pages (Money, Platform spend,
// Clients, Deadlines, Reports). Server-safe: no hooks.

type Tone = Parameters<typeof BigNum>[0]["tone"];

export interface Metric {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
  /** Extra content under the hint (a meter, a stacked bar). */
  extra?: ReactNode;
  /** Wider cell on desktop. */
  wide?: boolean;
}

const COLS: Record<number, string> = {
  2: "lg:grid-cols-2",
  3: "lg:grid-cols-3",
  4: "lg:grid-cols-4",
  5: "lg:grid-cols-5",
  6: "md:grid-cols-3 xl:grid-cols-6",
};

/** A row of big numbers divided by hairlines, for use inside a flush Card. */
export function Metrics({ items, cols }: { items: Metric[]; cols?: number }) {
  return (
    <div className="overflow-hidden">
      <div className={`-mb-px -mr-px grid grid-cols-2 ${COLS[cols ?? items.length] ?? "lg:grid-cols-4"}`}>
        {items.map((m, i) => (
          <div key={m.label} className={`min-w-0 border-b border-r border-line/70 px-4 py-4 sm:px-5 ${i === 0 && items.length % 2 === 1 ? "col-span-2 lg:col-span-1" : ""}`}>
            <div className="hud-label truncate text-[11px] text-muted">{m.label}</div>
            <div className="mt-2 truncate text-[22px] leading-tight sm:text-[26px]"><BigNum tone={m.tone ?? "ink"}>{m.value}</BigNum></div>
            {m.hint && <div className="mt-1 text-xs text-muted">{m.hint}</div>}
            {m.extra}
          </div>
        ))}
      </div>
    </div>
  );
}

/** A gold section heading with actions on the right (outside a panel). */
export function SectionHead({ id, title, children }: { id?: string; title: ReactNode; children?: ReactNode }) {
  return (
    <div id={id} className="mb-3 mt-8 flex scroll-mt-6 flex-wrap items-center gap-2">
      <h2 className="hud-title mr-auto py-2 pr-2 text-sm" style={{ "--a": "var(--ga, #ffd84d)" } as CSSProperties}>{title}</h2>
      {/* Children sit in this row, so a form a child opens can take the full width below. */}
      {children}
    </div>
  );
}

/** A filter chip that links to a URL (no client state). */
export function FilterChip({ href, on, children }: { href: string; on: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={on ? "true" : undefined}
      className={`hud-label inline-flex min-h-10 items-center border px-3 text-[11px] sm:min-h-8 ${on ? "border-[var(--ga,#ffd84d)] bg-[color-mix(in_srgb,var(--ga,#ffd84d)_10%,transparent)] text-[var(--ga,#ffd84d)]" : "border-line text-muted hover:text-ink"}`}
    >
      {children}
    </Link>
  );
}

/** A small colored letter tile for a vendor or a client. */
export function Monogram({ name, color, size = "sm" }: { name: string; color?: string; size?: "sm" | "md" }) {
  const c = color ?? businessColor(name);
  const letters = name.split(/\s+/).filter(Boolean).slice(0, size === "md" ? 2 : 1).map((w) => w[0]).join("").toUpperCase();
  return size === "md" ? (
    <span aria-hidden className="hud-cut grid h-10 w-10 shrink-0 place-items-center font-display text-[13px] font-bold" style={{ color: c, boxShadow: `inset 0 0 0 1.5px ${c}`, background: `color-mix(in srgb, ${c} 12%, transparent)` }}>{letters}</span>
  ) : (
    <span aria-hidden className="grid h-[26px] w-[26px] shrink-0 place-items-center font-display text-[11px] font-bold text-[#04131d] [clip-path:polygon(5px_0,100%_0,100%_calc(100%-5px),calc(100%-5px)_100%,0_100%,0_5px)]" style={{ background: c }}>{letters}</span>
  );
}

/** A thin horizontal meter (0–100). */
export function Meter({ pct, color, className = "" }: { pct: number; color: string; className?: string }) {
  return (
    <div className={`h-1.5 bg-cyan/[0.08] ${className}`}>
      <i className="block h-full" style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: `linear-gradient(90deg, ${color}, color-mix(in srgb, ${color} 35%, transparent))`, boxShadow: `0 0 8px color-mix(in srgb, ${color} 60%, transparent)` }} />
    </div>
  );
}

/** A stacked bar of parts (each with its own color). */
export function StackBar({ parts, label }: { parts: { value: number; color: string; title?: string }[]; label: string }) {
  const total = parts.reduce((n, p) => n + p.value, 0);
  if (!total) return null;
  return (
    <div className="mt-3 flex h-2.5 gap-[2px]" role="img" aria-label={label}>
      {parts.filter((p) => p.value > 0).map((p, i) => <i key={i} title={p.title} className="block" style={{ flex: p.value, background: p.color } as CSSProperties} />)}
    </div>
  );
}

/** Key/value line with a dashed divider. */
export function KV({ k, children }: { k: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-b border-dashed border-line/70 py-2.5 text-[13px] last:border-0">
      <span className="text-muted">{k}</span>
      <span className="text-right text-ink">{children}</span>
    </div>
  );
}

/** Problem colors only for problems; everything else is identity. */
export const WARN = "#ff9f1c";
export const CRIT = "#ff3d6e";

const LEVEL_COLOR = { critical: "#ff3d6e", high: "#ff9f1c", medium: "#3fd0ff", low: "#8fa6b8" } as const;

/** One attention line: severity shape + colored level word + what happened + an action. */
export function AlertRow({ severity, level, title, meta, action }: { severity: keyof typeof LEVEL_COLOR; level: string; title: ReactNode; meta?: ReactNode; action?: ReactNode }) {
  return (
    <div className="grid grid-cols-[30px_1fr] items-center gap-x-3 gap-y-2 border-b border-line/60 px-4 py-3.5 last:border-0 sm:grid-cols-[30px_1fr_auto] sm:px-5">
      <SeverityIcon severity={severity} size={26} />
      <div className="min-w-0">
        <div className="hud-label text-[11px]" style={{ color: LEVEL_COLOR[severity] }}>{level}</div>
        <div className="mt-0.5 text-[15px] font-medium">{title}</div>
        {meta && <div className="mt-0.5 text-xs text-muted">{meta}</div>}
      </div>
      {action && <div className="col-start-2 sm:col-start-auto">{action}</div>}
    </div>
  );
}
