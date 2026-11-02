import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { BigNum, SEVERITY_TEXT, SYS, SeverityIcon, appleColor, businessColor } from "@/components/ui";

// Building blocks shared by the Treasury pages (Money, Platform spend,
// Clients, Deadlines, Reports). Server-safe: no hooks. Apple style: see docs/DESIGN.md.

type Tone = Parameters<typeof BigNum>[0]["tone"];

export interface Metric {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  /** Only problems (critical/high) and "ok" colour a number; identity tones read as ink. */
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
  5: "md:grid-cols-3 xl:grid-cols-5",
  6: "md:grid-cols-3",
};

const signal = (t: Tone | undefined): Tone => (t === "critical" || t === "high" || t === "ok" ? t : "ink");

/** Key numbers as separate Apple tiles (2 per row on phones). */
export function Metrics({ items, cols, className = "" }: { items: Metric[]; cols?: number; className?: string }) {
  return (
    <div className={`grid grid-cols-2 gap-2.5 sm:gap-4 ${COLS[cols ?? items.length] ?? "lg:grid-cols-4"} ${className}`}>
      {items.map((m, i) => (
        <div key={m.label} className={`hud-panel min-w-0 px-4 py-3.5 sm:px-5 sm:py-4 ${i === 0 && items.length % 2 === 1 ? "col-span-2 md:col-span-1" : ""}`}>
          <div className="truncate text-[13px] font-medium text-muted">{m.label}</div>
          <div className="mt-1 truncate text-[24px] leading-tight sm:text-[28px]"><BigNum tone={signal(m.tone)}>{m.value}</BigNum></div>
          {m.hint && <div className="mt-0.5 text-[13px] leading-snug text-muted">{m.hint}</div>}
          {m.extra}
        </div>
      ))}
    </div>
  );
}

/** A 20px section heading with actions on the right (outside a card). */
export function SectionHead({ id, title, children }: { id?: string; title: ReactNode; children?: ReactNode }) {
  return (
    <div id={id} className="mb-2.5 mt-8 flex scroll-mt-24 flex-wrap items-center gap-2 px-1">
      <h2 className="mr-auto py-1 pr-2 text-[20px] font-bold tracking-[-0.01em] text-ink">{title}</h2>
      {/* Children sit in this row, so a form a child opens can take the full width below. */}
      {children}
    </div>
  );
}

/** A filter pill that links to a URL (no client state). Active = ink filled. */
export function FilterChip({ href, on, children }: { href: string; on: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={on ? "true" : undefined}
      className={`inline-flex min-h-10 shrink-0 items-center whitespace-nowrap rounded-full px-3.5 text-[14px] font-medium transition sm:min-h-8 ${on ? "bg-ink text-bg" : "bg-panel text-ink shadow-[0_0_0_1px_var(--color-line)] hover:bg-panel-2"}`}
    >
      {children}
    </Link>
  );
}

/** A row of filter pills that scrolls sideways on phones. */
export function FilterRow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`no-scrollbar -mx-4 flex min-w-0 gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 ${className}`}>{children}</div>;
}

/** A small coloured letter tile for a vendor (rounded square) or a client (circle). */
export function Monogram({ name, color, size = "sm" }: { name: string; color?: string; size?: "sm" | "md" }) {
  const c = appleColor(color ?? businessColor(name));
  const letters = name.split(/\s+/).filter(Boolean).slice(0, size === "md" ? 2 : 1).map((w) => w[0]).join("").toUpperCase();
  return size === "md" ? (
    <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-[15px] font-semibold text-white" style={{ background: c }}>{letters}</span>
  ) : (
    <span aria-hidden className="grid h-[29px] w-[29px] shrink-0 place-items-center rounded-[7px] text-[13px] font-semibold text-white" style={{ background: c }}>{letters}</span>
  );
}

/** A thin rounded meter (0–100), flat colour on a grey track. */
export function Meter({ pct, color, className = "" }: { pct: number; color: string; className?: string }) {
  return (
    <div className={`h-1.5 overflow-hidden rounded-full bg-fill ${className}`}>
      <i className="block h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: appleColor(color) }} />
    </div>
  );
}

/** A stacked bar of parts (each with its own colour). */
export function StackBar({ parts, label }: { parts: { value: number; color: string; title?: string }[]; label: string }) {
  const total = parts.reduce((n, p) => n + p.value, 0);
  if (!total) return null;
  return (
    <div className="mt-3 flex h-2 gap-[2px] overflow-hidden rounded-full" role="img" aria-label={label}>
      {parts.filter((p) => p.value > 0).map((p, i) => <i key={i} title={p.title} className="block" style={{ flex: p.value, background: appleColor(p.color) } as CSSProperties} />)}
    </div>
  );
}

/** Key/value line with a hairline divider. */
export function KV({ k, children }: { k: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-0.5 border-b border-line py-2.5 text-[15px] last:border-0">
      <span className="text-ink">{k}</span>
      <span className="text-right text-muted">{children}</span>
    </div>
  );
}

/** Problem colours only for problems; everything else is identity. */
export const WARN = SYS.orange;
export const CRIT = SYS.red;

type Level = "critical" | "high" | "medium" | "low";

/** One attention line for a Group (which draws the hairlines): severity shape + coloured level word + what happened + an action. */
export function AlertRow({ severity, level, title, meta, action }: { severity: Level; level: string; title: ReactNode; meta?: ReactNode; action?: ReactNode }) {
  return (
    <div className="grid grid-cols-[26px_1fr] items-center gap-x-3 gap-y-2 px-4 py-3 sm:grid-cols-[26px_1fr_auto] sm:px-5">
      <SeverityIcon severity={severity} size={24} />
      <div className="min-w-0">
        <div className="text-[13px] font-semibold" style={{ color: SEVERITY_TEXT[severity] }}>{level}</div>
        <div className="mt-0.5 text-[15px] leading-snug text-ink">{title}</div>
        {meta && <div className="mt-0.5 text-[13px] leading-snug text-muted">{meta}</div>}
      </div>
      {action && <div className="col-start-2 sm:col-start-auto">{action}</div>}
    </div>
  );
}

/** Column headings for a grid "table" (hidden on phones, where rows stack). */
export const colHead = "text-[12px] font-medium text-muted";
