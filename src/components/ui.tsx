import type { ReactNode } from "react";
import type { Severity, SourceMode } from "@/lib/types";
import { samplesEnabled } from "@/lib/source";

export function Card({ title, action, children, className = "" }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 rounded-xl border border-line bg-panel ${className}`}>
      {title && (
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold tracking-wide">{title}</h2>
          {action}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, mode, children }: { title: string; subtitle?: string; mode?: SourceMode; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="flex items-center gap-3 text-2xl font-semibold">{title}{mode && mode !== "live" && <ModePill mode={mode} />}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

const SEVERITY_STYLE: Record<Severity, string> = {
  critical: "bg-critical/15 text-critical ring-critical/40",
  high: "bg-high/15 text-high ring-high/40",
  medium: "bg-medium/15 text-medium ring-medium/40",
  low: "bg-low/15 text-low ring-low/40",
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider ring-1 ${SEVERITY_STYLE[severity]}`}>
      {severity}
    </span>
  );
}

export function Stat({ label, value, hint, tone = "ink" }: { label: string; value: ReactNode; hint?: string; tone?: "ink" | "critical" | "high" | "ok" }) {
  const color = { ink: "text-ink", critical: "text-critical", high: "text-high", ok: "text-ok" }[tone];
  return (
    <div className="rounded-xl border border-line bg-panel p-4">
      <div className="text-xs uppercase tracking-wider text-muted">{label}</div>
      <div className={`mt-2 text-3xl font-semibold tabular-nums ${color}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

export function StatusDot({ status }: { status: "ok" | "warn" | "bad" | "idle" }) {
  const c = { ok: "bg-ok", warn: "bg-high", bad: "bg-critical", idle: "bg-low" }[status];
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${c}`} />;
}

export function ModePill({ mode }: { mode: SourceMode | "planned" }) {
  const samples = samplesEnabled();
  const title = { live: "Live data", demo: samples ? "Sample data: connect this platform to see yours" : "Not connected yet", error: samples ? "Connection failing; showing sample data" : "Connection failing", planned: "Planned" }[mode];
  const style = {
    live: "bg-ok/15 text-ok",
    demo: "bg-low/20 text-muted",
    error: "bg-critical/15 text-critical",
    planned: "bg-accent/10 text-accent",
  }[mode];
  return <span title={title} className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${style}`}>{mode === "demo" ? (samples ? "sample data" : "not connected") : mode}</span>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-muted">{children}</p>;
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

export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="text-xs uppercase tracking-wider text-muted">
          <tr>{head.map((h) => <th key={h} className="border-b border-line px-3 py-2 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  );
}

export const td = "px-3 py-2.5 align-middle";
