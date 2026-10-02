import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { ACCENT, BigNum, Card, SeverityIcon, type Accent } from "@/components/ui";
import { FixButton } from "@/components/FixButton";
import { taskSection, type Section } from "@/lib/access";
import type { TaskView } from "@/lib/server/dashboard";
import { SEVERITY_ORDER, type Severity } from "@/lib/types";

type Tone = "ink" | "ok" | "high" | "critical" | Accent;

/** A stat tile with an optional progress bar (a real ratio only). */
export function MeterStat({ label, value, of, hint, tone = "ink", accent, bar }: { label: string; value: ReactNode; of?: ReactNode; hint?: ReactNode; tone?: Tone; accent?: Accent; bar?: number | null }) {
  const c = accent ? ACCENT[accent] : "var(--ga, #3fd0ff)";
  return (
    <div className="hud-panel flex flex-col p-4" style={accent ? ({ "--a": ACCENT[accent] } as CSSProperties) : undefined}>
      <div className="hud-label text-[11px] text-muted">{label}</div>
      <div className="mt-2 text-[26px] leading-none sm:text-3xl">
        <BigNum tone={tone}>{value}</BigNum>
        {of != null && <span className="ml-1 font-display text-base text-muted tabular-nums">/ {of}</span>}
      </div>
      {hint && <div className="mt-1.5 text-xs text-muted">{hint}</div>}
      {bar != null && (
        <div className="mt-auto hidden pt-3 sm:block">
          <div className="h-1 bg-white/5"><div className="h-full" style={{ width: `${Math.max(0, Math.min(1, bar)) * 100}%`, background: `linear-gradient(90deg, ${c}, color-mix(in srgb, ${c} 50%, #a98bff))`, boxShadow: `0 0 8px ${c}` }} /></div>
        </div>
      )}
    </div>
  );
}

export const STATUS_COLOR = { ok: "#3df5a0", warn: "#ff9f1c", bad: "#ff3d6e", info: "#3fd0ff", idle: "#7f97ab" } as const;
export type StatusKind = keyof typeof STATUS_COLOR;

/** Dot plus an uppercase word: status is never color alone. */
export function StatusWord({ kind, children }: { kind: StatusKind; children: ReactNode }) {
  const c = STATUS_COLOR[kind];
  return (
    <span className="inline-flex items-center gap-2 font-display text-[11px] font-bold uppercase tracking-[0.14em] whitespace-nowrap" style={{ color: c }}>
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: c, boxShadow: kind === "idle" ? undefined : `0 0 8px ${c}` }} />
      {children}
    </span>
  );
}

/** Filter chips as links (server-side filtering through the query string). */
export function FilterChips({ items, active, base }: { items: { key: string; label: string; count?: number }[]; active: string; base: string }) {
  return (
    <nav className="flex flex-wrap gap-2" aria-label="Filter">
      {items.map((i) => {
        const on = i.key === active;
        return (
          <Link
            key={i.key}
            href={i.key === "all" ? base : `${base}?show=${encodeURIComponent(i.key)}`}
            aria-current={on ? "true" : undefined}
            className={`hud-label inline-flex min-h-10 items-center border px-3 text-[11px] sm:min-h-0 sm:py-1.5 ${on ? "border-[var(--ga)] bg-[color-mix(in_srgb,var(--ga)_10%,transparent)] text-[var(--ga)]" : "border-line text-muted hover:text-ink"}`}
          >
            {i.label}{i.count != null && <span className="ml-1.5 tabular-nums">{i.count}</span>}
          </Link>
        );
      })}
    </nav>
  );
}

/** A note row at the foot of a panel. */
export function Note({ children, label = "Note" }: { children: ReactNode; label?: string }) {
  return (
    <div className="flex items-start gap-3 border-t border-line/70 px-4 py-3 text-xs text-muted sm:px-5">
      <span className="hud-label shrink-0 border border-muted/50 px-1.5 py-0.5 text-[10px] text-[#8fa6b8]">{label}</span>
      <span>{children}</span>
    </div>
  );
}

/** Horizontal bar rows: label, bar, value. */
export function BarRows({ rows, max }: { rows: { key: string; label: ReactNode; sub?: ReactNode; value: number; display?: ReactNode; color: string }[]; max?: number }) {
  const top = max ?? Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.key} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-[13px] sm:grid-cols-[minmax(0,12rem)_1fr_auto]">
          <span className="min-w-0"><span className="block truncate">{r.label}</span>{r.sub && <span className="block truncate text-[11px] text-muted">{r.sub}</span>}</span>
          <span className="h-2 bg-white/5"><span className="block h-full" style={{ width: `${(r.value / top) * 100}%`, background: `linear-gradient(90deg, ${r.color}, color-mix(in srgb, ${r.color} 40%, transparent))`, boxShadow: `0 0 8px color-mix(in srgb, ${r.color} 60%, transparent)` }} /></span>
          <span className="text-right font-mono text-xs tabular-nums">{r.display ?? r.value.toLocaleString()}</span>
        </li>
      ))}
    </ul>
  );
}

/** A ring gauge: value 0…1 around a circle with a big label in the middle. */
export function Ring({ frac, color, size = 150, children, label }: { frac: number; color: string; size?: number; children: ReactNode; label: string }) {
  const r = 62;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg viewBox="0 0 150 150" className="absolute inset-0 h-full w-full" aria-hidden>
        <circle cx="75" cy="75" r={r} fill="none" stroke={`color-mix(in srgb, ${color} 16%, transparent)`} strokeWidth="9" />
        <circle cx="75" cy="75" r={r} fill="none" stroke={color} strokeWidth="9" strokeLinecap="round" strokeDasharray={`${Math.max(0.001, Math.min(1, frac)) * c} ${c}`} transform="rotate(-90 75 75)" style={{ filter: `drop-shadow(0 0 8px ${color})` }} />
        <circle cx="75" cy="75" r="50" fill="none" stroke={`color-mix(in srgb, ${color} 28%, transparent)`} strokeDasharray="2 5" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div>
    </div>
  );
}

const SEV_COLOR: Record<Severity, string> = { critical: "#ff3d6e", high: "#ff9f1c", medium: "#3fd0ff", low: "#8fa6b8" };
const SEV_WORD: Record<Severity, string> = { critical: "Critical", high: "High", medium: "Medium", low: "Low" };

export interface AttentionItem {
  id: string;
  severity: Severity;
  title: ReactNode;
  detail?: ReactNode;
  business?: string | null;
  actions?: ReactNode;
  extra?: ReactNode;
}

/** "Needs attention": severity shape + color + word, the problem, and what you can do about it. */
export function Attention({ items, title = "Needs attention", foot }: { items: AttentionItem[]; title?: string; foot?: ReactNode }) {
  if (!items.length) return null;
  const counts = SEVERITY_ORDER.map((s) => [s, items.filter((i) => i.severity === s).length] as const).filter(([, n]) => n);
  return (
    <Card accent="pink" flush className="mb-5" title={title} action={counts.map(([s, n]) => `${n} ${SEV_WORD[s].toLowerCase()}`).join(" · ")}>
      <ul className="divide-y divide-line/70">
        {items.map((i) => (
          <li key={i.id} className="px-4 py-3.5 sm:px-5">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
              <SeverityIcon severity={i.severity} size={26} />
              <div className="min-w-0 flex-1 basis-56">
                <div className="hud-label text-[11px]" style={{ color: SEV_COLOR[i.severity] }}>{SEV_WORD[i.severity]}{i.business ? <span className="text-muted"> · {i.business}</span> : null}</div>
                <div className="mt-0.5 text-[15px] font-medium text-ink">{i.title}</div>
                {i.detail && <div className="mt-0.5 text-xs text-muted">{i.detail}</div>}
              </div>
              {i.actions && <div className="flex flex-wrap items-center gap-2">{i.actions}</div>}
            </div>
            {i.extra}
          </li>
        ))}
      </ul>
      {foot && <div className="border-t border-line/70 px-4 py-2.5 text-xs text-muted sm:px-5">{foot}</div>}
    </Card>
  );
}

/** Open tasks that belong to a section, as attention items with their one-click fix where one applies. */
export function tasksAsAttention(tasks: TaskView[], section: Section): AttentionItem[] {
  return tasks
    .filter((t) => taskSection(t.sourceKey ?? t.id) === section)
    .map((t) => ({
      id: t.id,
      severity: t.severity,
      title: t.title,
      detail: t.detail,
      business: t.business,
      actions: (
        <>
          {t.url && <a href={t.url} target={t.url.startsWith("/") ? undefined : "_blank"} rel="noreferrer" className="hud-btn min-h-10 sm:min-h-0" style={{ "--b": "#ff5fd7" } as CSSProperties}>Open</a>}
          {t.actionable && t.fix && <FixButton taskId={t.id} label={t.fix} title={t.title} />}
        </>
      ),
    }));
}

/** Responsive table: columns marked `wide` hide on phones. */
export function HudTable({ head, children }: { head: { label: string; wide?: boolean; right?: boolean }[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[13px]">
        <thead>
          <tr>{head.map((h, i) => <th key={`${h.label}-${i}`} className={`hud-label whitespace-nowrap border-b border-line px-3 py-2.5 text-[11px] font-semibold text-muted first:pl-4 last:pr-4 sm:first:pl-5 sm:last:pr-5 ${h.wide ? "hidden md:table-cell" : ""} ${h.right ? "text-right" : ""}`}>{h.label}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-line/50">{children}</tbody>
      </table>
    </div>
  );
}

/** Cell classes matching HudTable (pass wide to hide on phones). */
export const cell = (opts: { wide?: boolean; right?: boolean } = {}) => `px-3 py-2.5 align-middle first:pl-4 last:pr-4 sm:first:pl-5 sm:last:pr-5 ${opts.wide ? "hidden md:table-cell" : ""} ${opts.right ? "text-right" : ""}`;

/** Section subheading with a rule, as in "KAJ-CONSULTING.COM ───". */
export function SubHead({ children, color }: { children: ReactNode; color?: string }) {
  return (
    <div className="mb-3 mt-8 flex items-center gap-3">
      <h2 className="hud-title text-sm" style={color ? ({ "--a": color } as CSSProperties) : undefined}>{children}</h2>
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}
