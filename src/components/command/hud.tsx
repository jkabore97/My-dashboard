import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import type { Severity } from "@/lib/types";

// Small HUD building blocks shared by the Command pages.

export const SEV_COLOR: Record<Severity, string> = { critical: "#ff3d6e", high: "#ff9f1c", medium: "#3fd0ff", low: "#8fa6b8" };
export const SEV_WORD: Record<Severity, string> = { critical: "Critical", high: "High", medium: "Medium", low: "Low" };

export interface Kpi {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  /** Gradient colors of the number. */
  c1: string;
  c2?: string;
  /** Optional progress bar (0..1) under the number. */
  bar?: number;
  href?: string;
}

/** A row of numbers in one panel, divided by lines (2 per row on phones). */
export function KpiStrip({ items, accent = "#3fd0ff", className = "" }: { items: Kpi[]; accent?: string; className?: string }) {
  return (
    <div className={`hud-panel grid grid-cols-2 ${items.length >= 5 ? "lg:grid-cols-5" : items.length === 4 ? "md:grid-cols-4" : "md:grid-cols-3"} ${className}`} style={{ "--a": accent } as CSSProperties}>
      {items.map((k, i) => {
        const odd = items.length % 2 === 1 && i === 0;
        const body = (
          <>
            <div className="hud-label text-[11px] text-muted">{k.label}</div>
            <div className="mt-2 text-[26px] leading-none">
              <span className="hud-num" style={{ "--c1": k.c1, "--c2": k.c2 ?? k.c1 } as CSSProperties}>{k.value}</span>
            </div>
            {k.hint && <div className="mt-1.5 truncate text-xs text-muted">{k.hint}</div>}
            {k.bar !== undefined && (
              <div className="relative mt-2.5 h-1 bg-cyan/10">
                <i className="absolute inset-y-0 left-0" style={{ width: `${Math.max(0, Math.min(1, k.bar)) * 100}%`, background: k.c1, boxShadow: `0 0 8px ${k.c1}` }} />
              </div>
            )}
          </>
        );
        const cls = `min-w-0 border-b border-r border-line/60 px-4 py-4 sm:px-5 lg:border-b-0 ${odd ? "col-span-2 lg:col-span-1" : ""} last:border-r-0`;
        return k.href ? <Link key={k.label} href={k.href} className={`${cls} transition hover:bg-cyan/5`}>{body}</Link> : <div key={k.label} className={cls}>{body}</div>;
      })}
    </div>
  );
}

/** A filter chip (a link). `dot` is an identity color; counts use tabular figures. */
export function Chip({ href, active, children, count, dot }: { href: string; active: boolean; children: ReactNode; count?: number; dot?: string }) {
  return (
    <Link
      href={href}
      scroll={false}
      className={`inline-flex min-h-10 shrink-0 items-center gap-1.5 whitespace-nowrap border px-3 font-display text-[12px] font-semibold uppercase tracking-[0.12em] sm:min-h-0 sm:py-1.5 ${active ? "border-[var(--ga,#3fd0ff)] bg-[color-mix(in_srgb,var(--ga,#3fd0ff)_10%,transparent)] text-[var(--ga,#3fd0ff)]" : "border-line text-muted hover:text-ink"}`}
    >
      {dot && <span className="h-1.5 w-1.5 shrink-0" style={{ background: dot, boxShadow: `0 0 6px ${dot}` }} />}
      {children}
      {count !== undefined && <span className="font-mono text-[10.5px] tracking-normal opacity-80">{count}</span>}
    </Link>
  );
}

/** A labelled row of chips that scrolls sideways on phones instead of wrapping into a wall. */
export function ChipRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-3">
      <span className="hud-label min-w-[76px] pt-0 text-[11px] text-muted sm:pt-2">{label}</span>
      <div className="no-scrollbar -mx-4 flex min-w-0 gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">{children}</div>
    </div>
  );
}

/** A donut of parts (identity colors) with a number in the middle. */
export function Donut({ parts, value, label, size = 120 }: { parts: { value: number; color: string }[]; value: ReactNode; label: string; size?: number }) {
  const r = 46;
  const c = 2 * Math.PI * r;
  const total = parts.reduce((n, p) => n + p.value, 0);
  let offset = 0;
  return (
    <svg viewBox="0 0 120 120" width={size} height={size} className="shrink-0" role="img" aria-label={label}>
      <g transform="rotate(-90 60 60)" fill="none" strokeWidth="10">
        <circle cx="60" cy="60" r={r} stroke="rgb(63 208 255 / 0.1)" />
        {total > 0 &&
          parts.map((p, i) => {
            const len = (p.value / total) * c;
            const gap = parts.filter((x) => x.value > 0).length > 1 ? 2 : 0;
            const el = p.value > 0 ? <circle key={i} cx="60" cy="60" r={r} stroke={p.color} strokeDasharray={`${Math.max(0, len - gap)} ${c}`} strokeDashoffset={-offset} style={{ filter: `drop-shadow(0 0 4px ${p.color})` }} /> : null;
            offset += len;
            return el;
          })}
      </g>
      <text x="60" y="64" textAnchor="middle" fill="#eaf7ff" fontFamily="var(--font-display)" fontSize="24" fontWeight="600" style={{ fontVariantNumeric: "tabular-nums" }}>{value}</text>
      <text x="60" y="82" textAnchor="middle" fill="#7f97ab" fontFamily="var(--font-display)" fontSize="9.5" letterSpacing="2">{label.toUpperCase()}</text>
    </svg>
  );
}

/** A key/value line with a dashed divider. */
export function KV({ k, v, dot }: { k: ReactNode; v: ReactNode; dot?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-dashed border-line/70 py-1.5 text-[12.5px] text-muted last:border-0">
      <span className="flex min-w-0 items-center gap-2">{dot && <i className="h-2 w-2 shrink-0" style={{ background: dot }} />}<span className="truncate">{k}</span></span>
      <b className="font-mono font-medium tabular-nums text-ink">{v}</b>
    </div>
  );
}

/** A small circle with an initial, colored by identity. */
export function Avatar({ name, color }: { name: string; color: string }) {
  return (
    <span className="inline-grid h-5 w-5 shrink-0 place-items-center rounded-full font-display text-[10.5px] font-bold text-[#06121c]" style={{ background: color, boxShadow: `0 0 8px color-mix(in srgb, ${color} 50%, transparent)` }} aria-hidden>
      {(name.trim()[0] ?? "?").toUpperCase()}
    </span>
  );
}

/** Small action button class (outline, HUD cut). */
export const ab = "hud-cut inline-flex min-h-10 items-center gap-1.5 whitespace-nowrap border border-line bg-cyan/[0.04] px-2.5 font-display text-[12px] font-semibold tracking-[0.06em] text-[#b7c7d4] transition hover:border-cyan/50 hover:text-ink disabled:opacity-50 sm:min-h-8";
