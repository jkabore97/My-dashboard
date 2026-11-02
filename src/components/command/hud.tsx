import Link from "next/link";
import type { ReactNode } from "react";
import type { Severity } from "@/lib/types";

// Small building blocks shared by the Command pages (Apple style; see docs/DESIGN.md).

export const SEV_COLOR: Record<Severity, string> = { critical: "#ff3b30", high: "#ff9500", medium: "#007aff", low: "#8e8e93" };
/** Theme-aware severity colours for text (orange text uses the darker readable orange). */
export const SEV_TEXT: Record<Severity, string> = { critical: "var(--color-critical)", high: "var(--color-warn)", medium: "var(--color-cyan)", low: "var(--color-muted)" };
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

/** A row of number tiles (2 per row on phones). `c1` colours the number only when it signals a problem or "ok". */
export function KpiStrip({ items, className = "" }: { items: Kpi[]; accent?: string; className?: string }) {
  return (
    <div className={`grid grid-cols-2 gap-2.5 sm:gap-4 ${items.length >= 5 ? "lg:grid-cols-5" : items.length === 4 ? "md:grid-cols-4" : "md:grid-cols-3"} ${className}`}>
      {items.map((k, i) => {
        const odd = items.length % 2 === 1 && i === 0;
        const color = numColor(k.c1);
        const body = (
          <>
            <div className="truncate text-[13px] font-medium text-muted">{k.label}</div>
            <div className="mt-1 truncate text-[24px] leading-tight sm:text-[28px]">
              <span className="hud-num" style={color ? { color } : undefined}>{k.value}</span>
            </div>
            {k.hint && <div className="mt-0.5 truncate text-[13px] text-muted">{k.hint}</div>}
            {k.bar !== undefined && (
              <div className="relative mt-2.5 h-1.5 overflow-hidden rounded-full bg-fill">
                <i className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.max(0, Math.min(1, k.bar)) * 100}%`, background: color ?? "var(--color-cyan)" }} />
              </div>
            )}
          </>
        );
        const cls = `hud-panel block min-w-0 px-4 py-3.5 sm:px-5 sm:py-4 ${odd ? "col-span-2 lg:col-span-1" : ""}`;
        return k.href ? <Link key={k.label} href={k.href} className={`${cls} transition hover:bg-panel-2`}>{body}</Link> : <div key={k.label} className={cls}>{body}</div>;
      })}
    </div>
  );
}

/** Numbers stay ink unless their colour means something: red/orange problems, green "ok". */
function numColor(c?: string): string | undefined {
  const k = c?.toLowerCase();
  if (!k) return undefined;
  if (k === "#ff3d6e" || k === "#ff3b30") return "var(--color-critical)";
  if (k === "#ff9f1c" || k === "#ff9500") return "var(--color-warn)";
  if (k === "#3df5a0" || k === "#34c759") return "var(--color-ok)";
  return undefined;
}

/** A filter chip (a link): rounded pill, the active one filled with ink. */
export function Chip({ href, active, children, count, dot }: { href: string; active: boolean; children: ReactNode; count?: number; dot?: string }) {
  return (
    <Link
      href={href}
      scroll={false}
      className={`inline-flex min-h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-[14px] font-medium transition ${active ? "bg-ink text-bg" : "bg-panel text-ink shadow-[0_0_0_1px_var(--color-line)] hover:bg-panel-2"}`}
    >
      {dot && <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: dot }} />}
      {children}
      {count !== undefined && <span className={`text-[13px] tabular-nums ${active ? "opacity-70" : "text-muted"}`}>{count}</span>}
    </Link>
  );
}

/** A labelled row of chips that scrolls sideways on phones instead of wrapping into a wall. */
export function ChipRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-3">
      <span className="min-w-[76px] pt-0 text-[13px] text-muted sm:pt-2">{label}</span>
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
        <circle cx="60" cy="60" r={r} stroke="var(--color-fill)" />
        {total > 0 &&
          parts.map((p, i) => {
            const len = (p.value / total) * c;
            const gap = parts.filter((x) => x.value > 0).length > 1 ? 2 : 0;
            const el = p.value > 0 ? <circle key={i} cx="60" cy="60" r={r} stroke={p.color} strokeDasharray={`${Math.max(0, len - gap)} ${c}`} strokeDashoffset={-offset} /> : null;
            offset += len;
            return el;
          })}
      </g>
      <text x="60" y="64" textAnchor="middle" fill="var(--color-ink)" fontFamily="var(--font-sans)" fontSize="24" fontWeight="700" style={{ fontVariantNumeric: "tabular-nums" }}>{value}</text>
      <text x="60" y="81" textAnchor="middle" fill="var(--color-muted)" fontFamily="var(--font-sans)" fontSize="10.5">{label}</text>
    </svg>
  );
}

/** A key/value line with a dashed divider. */
export function KV({ k, v, dot }: { k: ReactNode; v: ReactNode; dot?: string }) {
  return (
    <div className="flex min-h-10 items-center justify-between gap-3 border-b border-line py-2 text-[15px] text-ink last:border-0">
      <span className="flex min-w-0 items-center gap-2">{dot && <i className="h-2 w-2 shrink-0 rounded-full" style={{ background: dot }} />}<span className="truncate">{k}</span></span>
      <b className="font-normal tabular-nums text-muted">{v}</b>
    </div>
  );
}

/** A small circle with an initial, colored by identity. */
export function Avatar({ name, color }: { name: string; color: string }) {
  return (
    <span className="inline-grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold text-white" style={{ background: color }} aria-hidden>
      {(name.trim()[0] ?? "?").toUpperCase()}
    </span>
  );
}

/** Small action button class (Apple secondary: grey fill, blue text). */
export const ab = "inline-flex min-h-10 items-center gap-1.5 whitespace-nowrap rounded-[10px] bg-fill px-3 text-[14px] font-semibold text-cyan transition hover:bg-fill-2 active:opacity-70 disabled:opacity-45 sm:min-h-8";
