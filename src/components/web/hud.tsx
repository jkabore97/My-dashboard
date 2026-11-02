import Link from "next/link";
import type { ReactNode } from "react";
import { ACCENT, BigNum, Card, Segmented, segItem, SeverityIcon, SYS, type Accent } from "@/components/ui";
import { FixButton } from "@/components/FixButton";
import { taskSection, type Section } from "@/lib/access";
import type { TaskView } from "@/lib/server/dashboard";
import { SEVERITY_ORDER, type Severity } from "@/lib/types";

// Building blocks for the web, build and sites pages (Apple style; see docs/DESIGN.md).

type Tone = "ink" | "ok" | "high" | "critical" | Accent;
/** Numbers stay ink unless the colour means something (problem or "ok"). */
const numTone = (t: Tone): "ink" | "ok" | "high" | "critical" => (t === "ok" || t === "high" || t === "critical" ? t : "ink");

/** A number tile (muted label, big bold value) with an optional progress bar (a real ratio only). */
export function MeterStat({ label, value, of, hint, tone = "ink", accent, bar }: { label: string; value: ReactNode; of?: ReactNode; hint?: ReactNode; tone?: Tone; accent?: Accent; bar?: number | null }) {
  const t = numTone(tone);
  const c = t === "high" ? SYS.orange : t === "critical" ? SYS.red : t === "ok" ? SYS.green : accent ? ACCENT[accent] : SYS.blue;
  return (
    <div className="hud-panel flex min-w-0 flex-col px-4 py-3.5 sm:px-5 sm:py-4">
      <div className="truncate text-[13px] font-medium text-muted">{label}</div>
      <div className="mt-1 truncate text-[24px] leading-tight sm:text-[30px]">
        <BigNum tone={t}>{value}</BigNum>
        {of != null && <span className="ml-1 text-[17px] font-semibold text-muted tabular-nums">/ {of}</span>}
      </div>
      {hint && <div className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-muted">{hint}</div>}
      {bar != null && (
        <div className="mt-auto pt-2.5">
          <div className="h-1.5 overflow-hidden rounded-full bg-fill"><div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(1, bar)) * 100}%`, background: c }} /></div>
        </div>
      )}
    </div>
  );
}

/** Dot colours (hexes, readable on both themes). */
export const STATUS_COLOR = { ok: SYS.green, warn: SYS.orange, bad: SYS.red, info: SYS.blue, idle: SYS.gray } as const;
export type StatusKind = keyof typeof STATUS_COLOR;
/** Text colours that follow the theme. */
const STATUS_TEXT: Record<StatusKind, string> = { ok: "var(--color-ok)", warn: "var(--color-warn)", bad: "var(--color-critical)", info: "var(--color-cyan)", idle: "var(--color-muted)" };

/** Dot plus a word: status is never colour alone. The word is shown in sentence case. */
export function StatusWord({ kind, children }: { kind: StatusKind; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] font-medium" style={{ color: STATUS_TEXT[kind] }}>
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: kind === "idle" ? "var(--color-low)" : STATUS_COLOR[kind] }} />
      {children !== "" && children != null && <span className="inline-block first-letter:uppercase">{children}</span>}
    </span>
  );
}

/** Filters as an iOS segmented control of links (server-side filtering through the query string). */
export function FilterChips({ items, active, base }: { items: { key: string; label: string; count?: number }[]; active: string; base: string }) {
  return (
    <nav aria-label="Filter" className="max-w-full">
      <Segmented>
        {items.map((i) => {
          const on = i.key === active;
          return (
            <Link key={i.key} href={i.key === "all" ? base : `${base}?show=${encodeURIComponent(i.key)}`} scroll={false} aria-current={on ? "true" : undefined} className={`${segItem(on)} inline-flex min-h-8 items-center gap-1.5`}>
              {i.label}{i.count != null && <span className="tabular-nums text-muted">{i.count}</span>}
            </Link>
          );
        })}
      </Segmented>
    </nav>
  );
}

/** A footnote at the foot of a card. */
export function Note({ children }: { children: ReactNode; label?: string }) {
  return <div className="border-t border-line px-4 py-3 text-[13px] leading-snug text-muted sm:px-5">{children}</div>;
}

/** Horizontal bar rows: label, bar, value. */
export function BarRows({ rows, max }: { rows: { key: string; label: ReactNode; sub?: ReactNode; value: number; display?: ReactNode; color: string }[]; max?: number }) {
  const top = max ?? Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.key} className="grid grid-cols-[minmax(0,8rem)_1fr_auto] items-center gap-3 text-[14px] sm:grid-cols-[minmax(0,12rem)_1fr_auto]">
          <span className="min-w-0"><span className="block truncate text-ink">{r.label}</span>{r.sub && <span className="block truncate text-[12px] text-muted">{r.sub}</span>}</span>
          <span className="h-2 overflow-hidden rounded-full bg-fill"><span className="block h-full rounded-full" style={{ width: `${(r.value / top) * 100}%`, background: r.color }} /></span>
          <span className="text-right text-[13px] font-medium tabular-nums text-ink">{r.display ?? r.value.toLocaleString()}</span>
        </li>
      ))}
    </ul>
  );
}

/** An Apple Fitness-style ring: value 0…1 around a circle with a big label in the middle. */
export function Ring({ frac, color, size = 150, children, label }: { frac: number; color: string; size?: number; children: ReactNode; label: string }) {
  const r = 62;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg viewBox="0 0 150 150" className="absolute inset-0 h-full w-full" aria-hidden>
        <circle cx="75" cy="75" r={r} fill="none" stroke={`color-mix(in srgb, ${color} 18%, transparent)`} strokeWidth="14" />
        <circle cx="75" cy="75" r={r} fill="none" stroke={color} strokeWidth="14" strokeLinecap="round" strokeDasharray={`${Math.max(0.001, Math.min(1, frac)) * c} ${c}`} transform="rotate(-90 75 75)" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div>
    </div>
  );
}

const SEV_TEXT: Record<Severity, string> = { critical: "var(--color-critical)", high: "var(--color-warn)", medium: "var(--color-cyan)", low: "var(--color-muted)" };
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

/** "Needs attention": severity shape + colour + word, the problem, and what you can do about it. */
export function Attention({ items, title = "Needs attention", foot }: { items: AttentionItem[]; title?: string; foot?: ReactNode }) {
  if (!items.length) return null;
  const counts = SEVERITY_ORDER.map((s) => [s, items.filter((i) => i.severity === s).length] as const).filter(([, n]) => n);
  return (
    <Card flush className="mb-5" title={title} action={counts.map(([s, n]) => `${n} ${SEV_WORD[s].toLowerCase()}`).join(" · ")}>
      <ul className="divide-y divide-line">
        {items.map((i) => (
          <li key={i.id} className="px-4 py-3 sm:px-5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5">
              <SeverityIcon severity={i.severity} size={22} />
              <div className="min-w-0 flex-1 basis-56">
                <div className="break-words text-[15px] font-medium leading-snug text-ink">{i.title}</div>
                <div className="mt-0.5 text-[13px] leading-snug text-muted">
                  <span className="font-semibold" style={{ color: SEV_TEXT[i.severity] }}>{SEV_WORD[i.severity]}</span>
                  {i.business ? ` · ${i.business}` : null}
                  {i.detail ? <> · {i.detail}</> : null}
                </div>
              </div>
              {i.actions && <div className="flex flex-wrap items-center gap-2">{i.actions}</div>}
            </div>
            {i.extra}
          </li>
        ))}
      </ul>
      {foot && <Note>{foot}</Note>}
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
          {t.url && <a href={t.url} target={t.url.startsWith("/") ? undefined : "_blank"} rel="noreferrer" className="hud-btn min-h-9 rounded-full px-3.5 py-1 text-[13px] sm:min-h-8">Open</a>}
          {t.actionable && t.fix && <FixButton taskId={t.id} label={t.fix} title={t.title} />}
        </>
      ),
    }));
}

/** Responsive table: columns marked `wide` hide on phones; the table scrolls inside its card if it must. */
export function HudTable({ head, children }: { head: { label: string; wide?: boolean; right?: boolean }[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[14px]">
        <thead>
          <tr>{head.map((h, i) => <th key={`${h.label}-${i}`} className={`whitespace-nowrap border-b border-line px-3 py-2.5 text-[12px] font-medium text-muted first:pl-4 last:pr-4 sm:first:pl-5 sm:last:pr-5 ${h.wide ? "hidden md:table-cell" : ""} ${h.right ? "text-right" : ""}`}>{h.label}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  );
}

/** Cell classes matching HudTable (pass wide to hide on phones). */
export const cell = (opts: { wide?: boolean; right?: boolean } = {}) => `px-3 py-3 align-middle first:pl-4 last:pr-4 sm:first:pl-5 sm:last:pr-5 ${opts.wide ? "hidden md:table-cell" : ""} ${opts.right ? "text-right" : ""}`;

/** A 20px section heading between groups of cards. */
export function SubHead({ children }: { children: ReactNode; color?: string }) {
  return <h2 className="mb-3 mt-8 px-1 text-[20px] font-bold tracking-[-0.01em] text-ink">{children}</h2>;
}
