import type { ReactNode } from "react";
import { Clocks } from "@/components/Clocks";
import { clockZones } from "@/lib/server/clocks";

/** The Kaj Consulting logo: the full logo on sign-in pages (dark text in light mode), the "K" mark when compact. */
export function Brand({ compact = false, tagline = "Kaj Consulting" }: { compact?: boolean; tagline?: string }) {
  if (compact) {
    return (
      <div className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/kaj-k.png" alt="Kaj Consulting" width={40} height={44} className="h-11 w-auto" />
        <div>
          <div className="text-[17px] font-semibold text-ink">Command Center</div>
          <div className="text-[13px] text-muted">{tagline}</div>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center text-center">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcSet="/brand/kaj-logo-full-light.png" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/kaj-logo-full-dark.png" alt="Kaj Consulting LLC" width={791} height={465} className="h-auto w-[180px] sm:w-[210px]" />
      </picture>
      <div className="mt-3 text-[17px] font-semibold text-ink">Command Center</div>
    </div>
  );
}

/** Centered Apple-style layout for pages outside the dashboard (sign-in, 2FA, invites). */
export function AuthShell({ children, brand = "full", footer = true }: { children: ReactNode; brand?: "full" | "compact"; footer?: boolean }) {
  return (
    <main className="flex min-h-screen flex-col items-center px-4 pb-10 pt-[calc(env(safe-area-inset-top)+40px)] sm:pt-16">
      <Brand compact={brand === "compact"} />
      <div className="mt-7 w-full sm:mt-9">{children}</div>
      {footer && (
        <footer className="mt-8 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[13px] text-muted">
          <Clocks zones={clockZones()} compact />
          <span>Secured with TLS and two-step verification</span>
        </footer>
      )}
    </main>
  );
}

/** One sign-in card. `state` dims a step that's done or still ahead; `step`/`label` show a small "Step 1 · Identify" line. */
export function AuthPanel({ step, label, title, state = "active", children, className = "" }: { step?: number; label?: string; title: ReactNode; accent?: string; state?: "active" | "done" | "next"; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-[20px] bg-panel p-6 shadow-[0_1px_3px_rgb(0_0_0/0.06),0_0_0_1px_var(--color-line)] sm:p-8 ${state === "next" ? "opacity-55" : ""} ${className}`} aria-current={state === "active" ? "step" : undefined}>
      {(step || label) && (
        <div className="mb-1.5 text-[13px] font-medium text-muted">
          {state === "done" ? "✓ " : ""}{step ? `Step ${step}` : ""}{step && label ? " · " : ""}{label}
        </div>
      )}
      <h1 className="text-[26px] font-bold leading-tight tracking-[-0.02em] text-ink sm:text-[28px]">{title}</h1>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export const msLogo = (
  <svg width="18" height="18" viewBox="0 0 21 21" aria-hidden="true"><path fill="#f25022" d="M1 1h9v9H1z" /><path fill="#7fba00" d="M11 1h9v9h-9z" /><path fill="#00a4ef" d="M1 11h9v9H1z" /><path fill="#ffb900" d="M11 11h9v9h-9z" /></svg>
);
