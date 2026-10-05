import type { CSSProperties, ReactNode } from "react";
import { Clocks } from "@/components/Clocks";
import { clockZones } from "@/lib/server/clocks";

/** The Kaj Consulting logo: the full logo on sign-in pages, the "K" mark when compact. */
export function Brand({ compact = false, tagline = "Kaj Consulting · Command Center" }: { compact?: boolean; tagline?: string }) {
  if (compact) {
    return (
      <div className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/kaj-k.png" alt="Kaj Consulting" width={40} height={44} className="h-11 w-auto drop-shadow-[0_0_8px_rgb(63_208_255/0.35)]" />
        <div>
          <div className="bg-gradient-to-r from-cyan via-violet to-pink bg-clip-text font-display text-lg font-bold tracking-[0.22em] text-transparent">KAJ // COMMAND</div>
          <div className="hud-label text-[11px] text-muted">{tagline}</div>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center text-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/kaj-logo-full-light.png" alt="Kaj Consulting LLC" width={791} height={465} className="h-auto w-[220px] drop-shadow-[0_0_14px_rgb(63_208_255/0.3)] sm:w-[260px]" />
      <div className="mt-4 bg-gradient-to-r from-cyan via-violet to-pink bg-clip-text font-display text-lg font-bold tracking-[0.3em] text-transparent sm:text-xl">COMMAND CENTER</div>
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
