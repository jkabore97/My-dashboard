import type { ReactNode } from "react";
import { appleColor, SYS } from "@/components/ui";

/** A label / value row with a hairline divider (iOS Settings style). */
export function Kv({ label, children, className = "", valueClass = "" }: { label: ReactNode; children: ReactNode; className?: string; valueClass?: string }) {
  return (
    <div className={`flex min-h-10 items-baseline justify-between gap-3 border-b border-line py-2.5 text-[15px] last:border-0 ${className}`}>
      <span className="text-ink">{label}</span>
      <span className={`min-w-0 text-right tabular-nums ${/\btext-(?!\[?\d)/.test(valueClass) ? valueClass : `text-muted ${valueClass}`}`}>{children}</span>
    </div>
  );
}

/** A 20px section heading between groups of cards. */
export function SectionRule({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <h2 className={`mb-3 px-1 text-[20px] font-bold tracking-[-0.01em] text-ink ${className}`}>{children}</h2>;
}

/** A thin rounded progress bar in one flat colour (`to` is ignored; kept for old callers). */
export function Meter({ pct, from = SYS.blue, className = "" }: { pct: number; from?: string; to?: string; className?: string }) {
  const w = Math.max(0, Math.min(100, pct));
  return (
    <div className={`relative h-2 overflow-hidden rounded-full bg-fill ${className}`} role="meter" aria-valuenow={w} aria-valuemin={0} aria-valuemax={100}>
      <i className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${w}%`, background: appleColor(from) }} />
    </div>
  );
}
