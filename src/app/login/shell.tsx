import type { CSSProperties, ReactNode } from "react";
import { Clocks } from "@/components/Clocks";
import { clockZones } from "@/lib/server/clocks";

/** Ringed "K" mark with the brand name. */
export function Brand({ compact = false, tagline = "Kaj Consulting · Command Center" }: { compact?: boolean; tagline?: string }) {
  if (compact) {
    return (
      <div className="flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-full border-[1.5px] border-violet font-display text-lg font-bold text-cyan shadow-[0_0_16px_rgb(63_208_255/0.45),inset_0_0_10px_rgb(63_208_255/0.35)]">K</span>
        <div>
          <div className="bg-gradient-to-r from-cyan via-violet to-pink bg-clip-text font-display text-lg font-bold tracking-[0.22em] text-transparent">KAJ // COMMAND</div>
          <div className="hud-label text-[11px] text-muted">{tagline}</div>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center text-center">
      <div className="relative grid h-28 w-28 place-items-center sm:h-32 sm:w-32">
        <span className="absolute inset-0 rounded-full border border-cyan/40 [border-right-color:#ff5fd7]" />
        <span className="absolute inset-3 rounded-full border border-dashed border-cyan/30" />
        <span className="grid h-[72px] w-[72px] place-items-center rounded-full border-[1.5px] border-violet font-display text-3xl font-bold text-cyan shadow-[0_0_20px_rgb(63_208_255/0.45),inset_0_0_12px_rgb(63_208_255/0.35)] sm:h-20 sm:w-20">K</span>
      </div>
      <div className="mt-3 bg-gradient-to-r from-cyan via-violet to-pink bg-clip-text font-display text-2xl font-bold tracking-[0.22em] text-transparent sm:text-[28px]">KAJ // COMMAND</div>
      <div className="hud-label mt-1 text-[11px] tracking-[0.28em] text-muted sm:text-xs">{tagline}</div>
    </div>
  );
}

/** Centered HUD layout for pages outside the dashboard (sign-in, 2FA, invites). */
export function AuthShell({ children, brand = "full", footer = true }: { children: ReactNode; brand?: "full" | "compact"; footer?: boolean }) {
  return (
    <main className="flex min-h-screen flex-col items-center px-4 py-10 sm:py-14">
      <Brand compact={brand === "compact"} />
      <div className="mt-8 w-full sm:mt-10">{children}</div>
      {footer && (
        <footer className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 font-display text-[11px] uppercase tracking-[0.18em] text-muted">
          <Clocks zones={clockZones()} compact />
          <span>Secured · TLS · 2FA</span>
        </footer>
      )}
    </main>
  );
}

/** One step of the sign-in flow. `state` dims a step that's done or still ahead. */
export function AuthPanel({ step, label, title, accent = "#3fd0ff", state = "active", children, className = "" }: { step?: number; label?: string; title: ReactNode; accent?: string; state?: "active" | "done" | "next"; children: ReactNode; className?: string }) {
  return (
    <section className={`hud-panel p-6 sm:p-8 ${state === "next" ? "opacity-55" : ""} ${className}`} style={{ "--a": accent } as CSSProperties} aria-current={state === "active" ? "step" : undefined}>
      {(step || label) && (
        <div className="mb-3 flex items-center gap-3">
          {step && <span className="grid h-7 w-7 place-items-center border font-mono text-xs" style={{ borderColor: accent, color: accent }}>{state === "done" ? "✓" : step}</span>}
          {label && <span className="hud-label text-[12px]" style={{ color: accent }}>{label}</span>}
        </div>
      )}
      <h1 className="font-display text-2xl font-semibold tracking-[0.04em] sm:text-[27px]">{title}</h1>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export const msLogo = (
  <svg width="18" height="18" viewBox="0 0 21 21" aria-hidden="true"><path fill="#f25022" d="M1 1h9v9H1z" /><path fill="#7fba00" d="M11 1h9v9h-9z" /><path fill="#00a4ef" d="M1 11h9v9H1z" /><path fill="#ffb900" d="M11 11h9v9h-9z" /></svg>
);
