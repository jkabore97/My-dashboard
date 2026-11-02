import type { CSSProperties, ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import type { Severity, SourceMode } from "@/lib/types";
import { samplesEnabled } from "@/lib/source";

// Shared Apple-style building blocks. The rules for using them are in docs/DESIGN.md.

/**
 * Apple system colours as plain 6-digit hexes, picked to read on both light and
 * dark backgrounds (safe to concatenate with a hex alpha, e.g. `${SYS.blue}22`).
 * For text and backgrounds that must follow the theme exactly, prefer the
 * Tailwind tokens (text-cyan, bg-panel …) or the CSS variables (var(--color-cyan)).
 */
export const SYS = {
  blue: "#007aff",
  indigo: "#5856d6",
  purple: "#af52de",
  pink: "#ff2d55",
  red: "#ff3b30",
  orange: "#ff9500",
  yellow: "#ffcc00",
  green: "#34c759",
  mint: "#00c7be",
  teal: "#30b0c7",
  cyan: "#32ade6",
  brown: "#a2845e",
  gray: "#8e8e93",
} as const;

/** Identity colors. Red and orange are never accents: they mean "problem". */
export type Accent = "cyan" | "teal" | "violet" | "pink" | "lime" | "gold" | "emerald";
export const ACCENT: Record<Accent, string> = {
  cyan: SYS.blue, teal: SYS.teal, violet: SYS.indigo, pink: SYS.pink, lime: SYS.green, gold: SYS.yellow, emerald: SYS.green,
};

/** Old HUD hexes → Apple colours, so leftover colour props in pages still come out right. */
const LEGACY: Record<string, string> = {
  "#3fd0ff": SYS.blue, "#2ef2d0": SYS.teal, "#a98bff": SYS.indigo, "#ff5fd7": SYS.pink, "#c6f432": SYS.green, "#ffd84d": SYS.yellow,
  "#3df5a0": SYS.green, "#ff3d6e": SYS.red, "#ff9f1c": SYS.orange, "#7f97ab": SYS.gray, "#8fa6b8": SYS.gray, "#5e7a8f": SYS.gray,
  "#9be7ff": SYS.cyan, "#7aa2ff": SYS.blue, "#e58bff": SYS.purple, "#5ee6ff": SYS.cyan, "#b4f0a0": SYS.mint, "#ffb3e6": SYS.pink, "#ff9f6b": SYS.orange,
};
/** Maps a colour from the old HUD palette to its Apple equivalent (other colours pass through). */
export const appleColor = (c: string) => LEGACY[c.toLowerCase()] ?? c;

/** Text in a tinted colour that stays readable: mixed toward the ink colour (darker in light mode, lighter in dark). */
export const readable = (c: string) => `color-mix(in srgb, ${c} 78%, var(--color-ink))`;
/** A soft tinted background for pills and badges. */
export const tint = (c: string, pct = 14) => `color-mix(in srgb, ${c} ${pct}%, transparent)`;

/** A white rounded card with an optional header (17px title, muted action on the right). */
export function Card({ title, action, children, className = "", flush = false }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; accent?: Accent; flush?: boolean }) {
  return (
    <section className={`hud-panel ${className}`}>
      {title && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
          <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>
          {action && <div className="text-[13px] text-muted [&_a:hover]:text-cyan [&_a]:text-cyan">{action}</div>}
        </header>
      )}
      <div className={flush ? "" : "p-4 sm:p-5"}>{children}</div>
    </section>
  );
}

/** iOS large title. Sentence case; the subtitle is muted. */
export function PageHeader({ title, subtitle, mode, children }: { title: string; subtitle?: string; mode?: SourceMode; children?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3 sm:mb-6">
      <div className="min-w-0">
        <h1 className="flex flex-wrap items-center gap-3 text-[30px] font-bold leading-tight tracking-[-0.02em] text-ink sm:text-[34px]">
          <span>{title}</span>
          {mode && mode !== "live" && <ModePill mode={mode} />}
        </h1>
        {subtitle && <p className="mt-1 text-[15px] text-muted">{subtitle}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

/** A section heading above a group or card (iOS 20px bold "Needs you"). */
export function SectionTitle({ children, action, className = "" }: { children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={`mb-2 flex items-baseline justify-between gap-3 px-1 ${className}`}>
      <h2 className="text-[20px] font-bold tracking-[-0.01em] text-ink">{children}</h2>
      {action && <div className="text-[15px] text-cyan [&_a:hover]:underline">{action}</div>}
    </div>
  );
}

// Severity colours: hexes for SVG and JS; CSS variables for text so it follows the theme.
const SEVERITY_COLOR: Record<Severity, string> = { critical: SYS.red, high: SYS.orange, medium: SYS.blue, low: SYS.gray };
export const SEVERITY_VAR: Record<Severity, string> = { critical: "var(--color-critical)", high: "var(--color-high)", medium: "var(--color-cyan)", low: "var(--color-low)" };
export const SEVERITY_TEXT: Record<Severity, string> = { critical: "var(--color-critical)", high: "var(--color-warn)", medium: "var(--color-cyan)", low: "var(--color-muted)" };
const SEVERITY_WORD: Record<Severity, string> = { critical: "Critical", high: "High", medium: "Medium", low: "Low" };

/** Severity shown three ways at once: shape, color and word (readable without color). */
export function SeverityIcon({ severity, size = 22 }: { severity: Severity; size?: number }) {
  const c = SEVERITY_VAR[severity];
  const s = size;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden className="shrink-0">
      {severity === "critical" && <><path d="M12 2.5 21.5 12 12 21.5 2.5 12Z" fill={c} /><path d="M12 7.5v6M12 16.5v.5" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" /></>}
      {severity === "high" && <><path d="M12 3.2 21.6 19.8H2.4Z" fill={c} strokeLinejoin="round" stroke={c} strokeWidth="1.2" /><path d="M12 9.5v5M12 17v.4" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" /></>}
      {severity === "medium" && <><circle cx="12" cy="12" r="8.5" fill="none" stroke={c} strokeWidth="2" /><circle cx="12" cy="12" r="3" fill={c} /></>}
      {severity === "low" && <circle cx="12" cy="12" r="7.5" fill="none" stroke={c} strokeWidth="1.8" strokeDasharray="2.6 3" />}
    </svg>
  );
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  const c = SEVERITY_VAR[severity];
  return (
    <span className="inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[12px] font-semibold" style={{ color: SEVERITY_TEXT[severity], background: tint(c, 15) }}>
      {SEVERITY_WORD[severity]}
    </span>
  );
}

/** A coloured dot for list rows (Needs you, alerts …). */
export function Dot({ color, className = "" }: { color: string; className?: string }) {
  return <span aria-hidden className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${className}`} style={{ background: color }} />;
}

type Tone = "ink" | "critical" | "high" | "ok" | Accent;
const TONE: Record<Tone, string> = {
  ink: "var(--color-ink)", critical: "var(--color-critical)", high: "var(--color-warn)", ok: "var(--color-ok)",
  cyan: "var(--color-cyan)", teal: "var(--color-teal)", violet: "var(--color-violet)", pink: "var(--color-pink)", lime: "var(--color-lime)", gold: "var(--color-gold)", emerald: "var(--color-emerald)",
};
/** CSS colour for a tone (theme-aware). */
export const toneColor = (tone: Tone = "ink") => TONE[tone];

/** A big number: bold, tabular. Only problems (critical/high) and "ok" usually get a colour. */
export function BigNum({ children, tone = "ink", className = "" }: { children: ReactNode; tone?: Tone; className?: string }) {
  return <span className={`hud-num ${className}`} style={{ color: TONE[tone] }}>{children}</span>;
}

/** Apple tile: muted label, big bold value, coloured hint. */
export function Stat({ label, value, hint, tone = "ink", hintTone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone; accent?: Accent; hintTone?: Tone }) {
  return (
    <div className="hud-panel min-w-0 px-4 py-3.5 sm:px-5 sm:py-4">
      <div className="truncate text-[13px] font-medium text-muted">{label}</div>
      <div className="mt-1 truncate text-[24px] leading-tight sm:text-[30px]"><BigNum tone={tone}>{value}</BigNum></div>
      {hint && <div className="mt-0.5 truncate text-[13px] font-medium" style={{ color: hintTone ? TONE[hintTone] : "var(--color-muted)" }}>{hint}</div>}
    </div>
  );
}

/** A row of stats as separate tiles (2 per row on phones). */
export function StatStrip({ items }: { items: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone; hintTone?: Tone }[]; accent?: Accent }) {
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-[repeat(auto-fit,minmax(170px,1fr))] sm:gap-4">
      {items.map((s) => <Stat key={s.label} label={s.label} value={s.value} hint={s.hint} tone={s.tone} hintTone={s.hintTone} />)}
    </div>
  );
}

export function StatusDot({ status }: { status: "ok" | "warn" | "bad" | "idle" }) {
  const c = { ok: "bg-ok", warn: "bg-high", bad: "bg-critical", idle: "bg-low/50" }[status];
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${c}`} />;
}

export function ModePill({ mode }: { mode: SourceMode | "planned" }) {
  const samples = samplesEnabled();
  const title = { live: "Live data", demo: samples ? "Sample data: connect this platform to see yours" : "Not connected yet", error: samples ? "Connection failing; showing sample data" : "Connection failing", planned: "Planned" }[mode];
  const color = { live: "var(--color-ok)", demo: "var(--color-low)", error: "var(--color-critical)", planned: "var(--color-cyan)" }[mode];
  const word = { live: "Live", demo: samples ? "Sample data" : "Not connected", error: "Error", planned: "Planned" }[mode];
  return (
    <span title={title} className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 align-middle text-[12px] font-semibold tracking-normal" style={{ color: mode === "demo" ? "var(--color-muted)" : readable(color), background: tint(color, 14) }}>
      {mode === "live" && <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />}
      {word}
    </span>
  );
}

/** A small rounded pill with a tinted background. `color` is any CSS color; use red/orange only for problems. */
export function Tag({ children, color = SYS.gray, title }: { children: ReactNode; color?: string; title?: string }) {
  const c = appleColor(color);
  const gray = c === SYS.gray;
  return (
    <span title={title} className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] font-semibold" style={{ color: gray ? "var(--color-muted)" : readable(c), background: tint(c, gray ? 16 : 14) }}>
      {children}
    </span>
  );
}

/** Business name with its identity color dot. */
export function BizLabel({ name, className = "" }: { name: string | null | undefined; className?: string }) {
  if (!name) return null;
  const color = businessColor(name);
  return (
    <span className={`inline-flex items-center gap-1.5 text-[13px] text-muted ${className}`}>
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
      {name}
    </span>
  );
}

const BIZ_COLORS = [SYS.blue, SYS.indigo, SYS.teal, SYS.purple, SYS.pink, SYS.green, SYS.mint, SYS.cyan, SYS.brown, "#d4a300", "#5e5ce6", "#64d2ff"];
/** A stable identity color per business name (never red or orange). */
export function businessColor(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return BIZ_COLORS[h % BIZ_COLORS.length];
}

/** Colours for chart series and bar segments, in order (identity only, never red/orange). */
export const CHART_COLORS = [SYS.blue, SYS.green, SYS.indigo, SYS.teal, SYS.pink, SYS.purple, SYS.mint, SYS.cyan];

export function Empty({ children }: { children: ReactNode }) {
  return <p className="px-4 py-8 text-center text-[15px] text-muted">{children}</p>;
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
      <table className="w-full text-left text-[14px]" style={{ minWidth }}>
        <thead>
          <tr>{head.map((h, i) => <th key={`${h}-${i}`} className="border-b border-line px-3 py-2.5 text-[12px] font-medium text-muted">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  );
}

export const td = "px-3 py-2.5 align-middle";

/** Button classes: `btn()` grey/blue secondary, `btn("solid")` filled blue, `btn("danger")` filled red, `btn("plain")` blue text only. */
export const btn = (kind: "outline" | "solid" | "danger" | "plain" = "outline") =>
  kind === "plain"
    ? "inline-flex min-h-9 items-center gap-1.5 rounded-lg px-1.5 text-[15px] font-normal text-cyan hover:opacity-70 disabled:opacity-40"
    : `hud-btn ${kind === "solid" ? "hud-btn-solid" : ""} ${kind === "danger" ? "hud-btn-solid [--b:var(--color-critical)]" : ""}`;

export const input = "hud-input w-full px-3 py-2 text-[15px] placeholder:text-muted/70";

// ---------------------------------------------------------------------------
// Grouped lists (iOS Settings / Reminders). Use these for most page content.

/** An inset grouped list: rounded panel, hairline dividers between rows. Optional small grey header and footer text. */
export function Group({ header, footer, children, className = "", id }: { header?: ReactNode; footer?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={`scroll-mt-24 ${className}`}>
      {header && <h3 className="mb-1.5 px-4 text-[13px] font-normal uppercase tracking-[0.02em] text-muted">{header}</h3>}
      <div className="overflow-hidden rounded-[14px] bg-panel shadow-[0_0_0_1px_var(--color-line)] [&>*+*]:border-t [&>*+*]:border-line">{children}</div>
      {footer && <div className="mt-1.5 px-4 text-[13px] leading-snug text-muted">{footer}</div>}
    </section>
  );
}

/**
 * One row of a Group: optional icon tile, label + subtitle on the left, value or control on the right.
 * With `href` the whole row is a link and shows a chevron.
 */
export function Row({ icon, iconColor, label, sub, value, children, href, external = false, chevron, className = "" }: { icon?: ReactNode; iconColor?: string; label: ReactNode; sub?: ReactNode; value?: ReactNode; children?: ReactNode; href?: string; external?: boolean; chevron?: boolean; className?: string }) {
  const body = (
    <>
      {icon && <IconTile color={iconColor}>{icon}</IconTile>}
      <div className="min-w-0 flex-1">
        <div className="break-words text-[15px] leading-snug text-ink">{label}</div>
        {sub && <div className="mt-0.5 break-words text-[13px] leading-snug text-muted">{sub}</div>}
      </div>
      {value !== undefined && <div className="shrink-0 text-right text-[15px] text-muted">{value}</div>}
      {children && <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{children}</div>}
      {(chevron ?? !!href) && <ChevronRight size={18} className="shrink-0 text-low/70" aria-hidden />}
    </>
  );
  const cls = `flex min-h-11 items-center gap-3 px-4 py-2.5 ${className}`;
  if (href) {
    return (
      <a href={href} target={external ? "_blank" : undefined} rel={external ? "noreferrer" : undefined} className={`${cls} transition-colors hover:bg-fill active:bg-fill`}>
        {body}
      </a>
    );
  }
  return <div className={cls}>{body}</div>;
}

/** Free content inside a Group (forms, paragraphs) with row padding. */
export function GroupBody({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`px-4 py-3.5 text-[15px] ${className}`}>{children}</div>;
}

/** A small rounded-square icon tile: white glyph on a system colour (sidebar, Settings rows). */
export function IconTile({ color = SYS.gray, children, size = 29 }: { color?: string; children: ReactNode; size?: number }) {
  return (
    <span aria-hidden className="grid shrink-0 place-items-center rounded-[7px] text-white" style={{ background: appleColor(color), width: size, height: size }}>
      {children}
    </span>
  );
}

/**
 * iOS switch for a boolean. A real checkbox underneath, so forms post it as before
 * (`name`, `defaultChecked` / `checked` + `onChange`).
 */
export function Switch({ name, defaultChecked, checked, onChange, disabled, label, className = "" }: { name?: string; defaultChecked?: boolean; checked?: boolean; onChange?: (on: boolean) => void; disabled?: boolean; label?: string; className?: string }) {
  return (
    <span className={`relative inline-flex shrink-0 ${className}`}>
      <input
        type="checkbox"
        role="switch"
        name={name}
        aria-label={label}
        defaultChecked={defaultChecked}
        checked={checked}
        disabled={disabled}
        onChange={onChange ? (e) => onChange(e.target.checked) : undefined}
        className="peer absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0 disabled:cursor-default"
      />
      <span aria-hidden className="h-[31px] w-[51px] rounded-full bg-fill-2 transition-colors peer-checked:bg-ok peer-focus-visible:ring-[3px] peer-focus-visible:ring-cyan/40 peer-disabled:opacity-50" />
      <span aria-hidden className="pointer-events-none absolute left-[2px] top-[2px] h-[27px] w-[27px] rounded-full bg-white shadow-[0_3px_8px_rgb(0_0_0/0.15),0_1px_1px_rgb(0_0_0/0.16)] transition-transform peer-checked:translate-x-[20px]" />
    </span>
  );
}

/** Spacing helper so a page of Groups reads like iOS Settings. */
export function Groups({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`grid content-start gap-7 ${className}`}>{children}</div>;
}

/** A segmented control made of links or buttons (pass the items already rendered). */
export function Segmented({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-[9px] bg-fill p-0.5 no-scrollbar ${className}`}>{children}</div>;
}
export const segItem = (active: boolean) =>
  `whitespace-nowrap rounded-[7px] px-3.5 py-1 text-[13px] font-medium transition ${active ? "bg-panel text-ink shadow-[0_1px_3px_rgb(0_0_0/0.12)] dark:bg-[#636366]" : "text-ink/80 hover:text-ink"}`;

export const styleVar = (vars: Record<string, string>) => vars as CSSProperties;
