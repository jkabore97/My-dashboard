import type { CSSProperties, ReactNode } from "react";
import type { Severity, SourceMode } from "@/lib/types";
import { samplesEnabled } from "@/lib/source";

/** Identity colors. Red and orange are never accents: they mean "problem". */
export type Accent = "cyan" | "teal" | "violet" | "pink" | "lime" | "gold" | "emerald";
export const ACCENT: Record<Accent, string> = {
  cyan: "#3fd0ff", teal: "#2ef2d0", violet: "#a98bff", pink: "#ff5fd7", lime: "#c6f432", gold: "#ffd84d", emerald: "#3df5a0",
};
const accentStyle = (accent?: Accent): CSSProperties | undefined => (accent ? ({ "--a": ACCENT[accent] } as CSSProperties) : undefined);

/** A HUD panel. Without an accent it takes the color of the section group. */
export function Card({ title, action, children, className = "", accent, flush = false }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; accent?: Accent; flush?: boolean }) {
  return (
    <section className={`hud-panel ${className}`} style={accentStyle(accent)}>
      {title && (
        <header className="hud-head flex flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-5">
          <h2 className="hud-title text-[13px]">{title}</h2>
          {action && <div className="hud-label text-[11px] tracking-[0.12em] text-muted">{action}</div>}
        </header>
      )}
      <div className={flush ? "" : "p-4 sm:p-5"}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, mode, children }: { title: string; subtitle?: string; mode?: SourceMode; children?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="flex flex-wrap items-center gap-3 font-display text-2xl font-semibold uppercase tracking-[0.06em] sm:text-[28px]">
          <span className="bg-gradient-to-r from-[var(--ga,#3fd0ff)] to-[#eaf7ff] bg-clip-text text-transparent">{title}</span>
          {mode && mode !== "live" && <ModePill mode={mode} />}
        </h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

const SEVERITY_COLOR: Record<Severity, string> = { critical: "#ff3d6e", high: "#ff9f1c", medium: "#3fd0ff", low: "#8fa6b8" };
const SEVERITY_WORD: Record<Severity, string> = { critical: "Critical", high: "High", medium: "Medium", low: "Low" };

/** Severity shown three ways at once: shape, color and word (readable without color). */
export function SeverityIcon({ severity, size = 22 }: { severity: Severity; size?: number }) {
  const c = SEVERITY_COLOR[severity];
  const s = size;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden className="shrink-0" style={{ filter: severity === "critical" || severity === "high" ? `drop-shadow(0 0 5px ${c})` : undefined }}>
      {severity === "critical" && <><path d="M12 2 22 12 12 22 2 12Z" fill={`${c}22`} stroke={c} strokeWidth="1.6" /><path d="M12 7.5v6M12 16.5v.5" stroke={c} strokeWidth="2" strokeLinecap="round" /></>}
      {severity === "high" && <><path d="M12 3 22 20H2Z" fill={`${c}2e`} stroke={c} strokeWidth="1.4" strokeLinejoin="round" /><path d="M12 9.5v5M12 17v.4" stroke={c} strokeWidth="2" strokeLinecap="round" /></>}
      {severity === "medium" && <><circle cx="12" cy="12" r="9" fill="none" stroke={c} strokeWidth="1.6" /><circle cx="12" cy="12" r="2.2" fill={c} /></>}
      {severity === "low" && <circle cx="12" cy="12" r="8" fill="none" stroke={c} strokeWidth="1.4" strokeDasharray="2.5 3" />}
    </svg>
  );
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  const c = SEVERITY_COLOR[severity];
  return (
    <span className="hud-cut inline-flex shrink-0 items-center px-1.5 py-0.5 font-display text-[11px] font-bold uppercase tracking-[0.12em]" style={{ color: c, background: `${c}1a`, boxShadow: `inset 0 0 0 1px ${c}66` }}>
      {SEVERITY_WORD[severity]}
    </span>
  );
}

type Tone = "ink" | "critical" | "high" | "ok" | Accent;
const TONE: Record<Tone, [string, string]> = {
  ink: ["#eaf7ff", "#9be7ff"], critical: ["#ff3d6e", "#ff7a9a"], high: ["#ff9f1c", "#ffc56b"], ok: ["#3df5a0", "#2ef2d0"],
  cyan: ["#3fd0ff", "#a98bff"], teal: ["#2ef2d0", "#3fd0ff"], violet: ["#a98bff", "#ff5fd7"], pink: ["#ff5fd7", "#a98bff"], lime: ["#c6f432", "#3df5a0"], gold: ["#ffd84d", "#ff9f6b"], emerald: ["#3df5a0", "#2ef2d0"],
};

/** A big number with a gradient. */
export function BigNum({ children, tone = "ink", className = "" }: { children: ReactNode; tone?: Tone; className?: string }) {
  const [c1, c2] = TONE[tone];
  return <span className={`hud-num ${className}`} style={{ "--c1": c1, "--c2": c2 } as CSSProperties}>{children}</span>;
}

export function Stat({ label, value, hint, tone = "ink", accent }: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone; accent?: Accent }) {
  return (
    <div className="hud-panel p-4" style={accentStyle(accent)}>
      <div className="hud-label text-[11px] text-muted">{label}</div>
      <div className="mt-2 text-[26px] leading-none sm:text-3xl"><BigNum tone={tone}>{value}</BigNum></div>
      {hint && <div className="mt-1.5 text-xs text-muted">{hint}</div>}
    </div>
  );
}

/** A row of stats inside one panel, divided by lines (the "Treasury" look). */
export function StatStrip({ items, accent }: { items: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone }[]; accent?: Accent }) {
  return (
    <div className="hud-panel grid grid-cols-2 sm:grid-cols-[repeat(auto-fit,minmax(150px,1fr))]" style={accentStyle(accent)}>
      {items.map((s) => (
        <div key={s.label} className="border-b border-r border-line/70 p-4 last:border-r-0">
          <div className="hud-label text-[11px] text-muted">{s.label}</div>
          <div className="mt-2 text-2xl leading-none sm:text-[26px]"><BigNum tone={s.tone ?? "ink"}>{s.value}</BigNum></div>
          {s.hint && <div className="mt-1.5 text-xs text-muted">{s.hint}</div>}
        </div>
      ))}
    </div>
  );
}

export function StatusDot({ status }: { status: "ok" | "warn" | "bad" | "idle" }) {
  const c = { ok: "bg-[#5e7a8f]", warn: "bg-high shadow-[0_0_6px_#ff9f1c]", bad: "bg-critical shadow-[0_0_6px_#ff3d6e]", idle: "bg-line" }[status];
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${c}`} />;
}

export function ModePill({ mode }: { mode: SourceMode | "planned" }) {
  const samples = samplesEnabled();
  const title = { live: "Live data", demo: samples ? "Sample data: connect this platform to see yours" : "Not connected yet", error: samples ? "Connection failing; showing sample data" : "Connection failing", planned: "Planned" }[mode];
  const color = { live: "#3df5a0", demo: "#7f97ab", error: "#ff3d6e", planned: "#3fd0ff" }[mode];
  return (
    <span title={title} className="hud-cut inline-flex items-center gap-1.5 px-2 py-0.5 font-display text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color, background: `${color}14`, boxShadow: `inset 0 0 0 1px ${color}55` }}>
      {mode === "live" && <span className="h-1.5 w-1.5 rounded-full" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />}
      {mode === "demo" ? (samples ? "sample data" : "not connected") : mode}
    </span>
  );
}

/** A small labelled chip. `color` is any CSS color; use red/orange only for problems. */
export function Tag({ children, color = "#7f97ab", title }: { children: ReactNode; color?: string; title?: string }) {
  return (
    <span title={title} className="hud-cut inline-flex shrink-0 items-center gap-1.5 px-2 py-0.5 font-display text-[11px] font-semibold uppercase tracking-[0.1em]" style={{ color, background: `color-mix(in srgb, ${color} 10%, transparent)`, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${color} 45%, transparent)` }}>
      {children}
    </span>
  );
}

/** Business name with its identity color dot. */
export function BizLabel({ name, className = "" }: { name: string | null | undefined; className?: string }) {
  if (!name) return null;
  const color = businessColor(name);
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs text-[#c5d3de] ${className}`}>
      <span className="h-1.5 w-1.5 shrink-0" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
      {name}
    </span>
  );
}

const BIZ_COLORS = ["#3fd0ff", "#a98bff", "#2ef2d0", "#ff5fd7", "#c6f432", "#ffd84d", "#3df5a0", "#7aa2ff", "#e58bff", "#5ee6ff", "#b4f0a0", "#ffb3e6"];
/** A stable identity color per business name (never red or orange). */
export function businessColor(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return BIZ_COLORS[h % BIZ_COLORS.length];
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-8 text-center text-sm text-muted">{children}</p>;
}

export function timeAgo(iso: string | null | undefined) {
  if (!iso) return "—";
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function Table({ head, children, minWidth = 640 }: { head: string[]; children: ReactNode; minWidth?: number }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm" style={{ minWidth }}>
        <thead>
          <tr>{head.map((h, i) => <th key={`${h}-${i}`} className="hud-label border-b border-line px-3 py-2.5 text-[11px] font-semibold text-muted">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-line/60">{children}</tbody>
      </table>
    </div>
  );
}

export const td = "px-3 py-2.5 align-middle";

/** Button classes: `btn()` for outline, `btn("solid")` for the main action. Pass a color via style={{"--b": …}} when needed. */
export const btn = (kind: "outline" | "solid" | "danger" = "outline") =>
  `hud-btn ${kind === "solid" ? "hud-btn-solid" : ""} ${kind === "danger" ? "hud-btn-solid [--b:#ff3d6e]" : ""}`;

export const input = "hud-input w-full px-3 py-2 text-sm placeholder:text-muted/70";
