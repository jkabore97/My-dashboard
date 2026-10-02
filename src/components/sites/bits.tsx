import type { CSSProperties, ReactNode } from "react";

/** A label / value row with a dotted divider (HUD "kv" look). */
export function Kv({ label, children, className = "", valueClass = "" }: { label: ReactNode; children: ReactNode; className?: string; valueClass?: string }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 border-b border-dashed border-line/70 py-2 text-[13px] last:border-0 ${className}`}>
      <span className="text-muted">{label}</span>
      <span className={`min-w-0 text-right font-mono tabular-nums ${valueClass}`}>{children}</span>
    </div>
  );
}

/** Section divider between groups of panels ("REAL-TIME WEBHOOKS ———"). */
export function SectionRule({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <h2 className={`hud-label mb-3 flex items-center gap-4 text-[12px] text-muted ${className}`}>
      <span className="shrink-0">{children}</span>
      <span className="h-px flex-1 bg-line" />
    </h2>
  );
}

/** A thin gradient progress bar. */
export function Meter({ pct, from = "#a98bff", to = "#3fd0ff", className = "" }: { pct: number; from?: string; to?: string; className?: string }) {
  const w = Math.max(0, Math.min(100, pct));
  return (
    <div className={`relative h-2 bg-violet/15 ${className}`} role="meter" aria-valuenow={w} aria-valuemin={0} aria-valuemax={100}>
      <i className="absolute inset-y-0 left-0" style={{ width: `${w}%`, background: `linear-gradient(90deg, ${from}, ${to})`, boxShadow: `0 0 8px color-mix(in srgb, ${from} 60%, transparent)` } as CSSProperties} />
    </div>
  );
}
