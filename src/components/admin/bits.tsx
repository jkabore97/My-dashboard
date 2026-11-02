import type { ReactNode } from "react";

/** Identity color per platform (never red/orange: those mean "problem"). */
export const PLATFORM_COLOR: Record<string, string> = {
  microsoft: "#007aff", github: "#5856d6", vercel: "#636366", supabase: "#34c759", cloudflare: "#f4a100", stripe: "#635bff",
  websites: "#30b0c7", hikvision: "#a2845e", solar: "#f4b400", resend: "#ff2d55", gmail: "#32ade6", claude: "#af52de", reviews: "#f4b400",
  msadmin: "#007aff", gcloud: "#00c7be",
};

const MONO: Record<string, string> = { microsoft: "M", github: "GH", vercel: "▲", supabase: "S", cloudflare: "CF", stripe: "$", websites: "◎", hikvision: "H", solar: "☀", resend: "R", gmail: "G", claude: "✳", reviews: "★", msadmin: "MA", gcloud: "GC" };

/** A small rounded-square monogram for a platform card (white glyph on the platform colour). */
export function Monogram({ id, name }: { id: string; name: string }) {
  const c = PLATFORM_COLOR[id] ?? "#007aff";
  return (
    <span aria-hidden className="grid h-[29px] w-[29px] shrink-0 place-items-center rounded-[7px] text-[11px] font-bold text-white" style={{ background: c }}>
      {MONO[id] ?? name.slice(0, 1)}
    </span>
  );
}

/** A card whose header carries an icon, a title and a status (muted text or a Tag). `accent` is kept for old callers and unused. */
export function HeadPanel({ id, title, icon, status, children, className = "", bodyClassName = "" }: { id?: string; title: ReactNode; icon?: ReactNode; status?: ReactNode; accent?: string; children: ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section id={id} className={`hud-panel flex scroll-mt-24 flex-col ${className}`}>
      <header className="flex items-center gap-3 border-b border-line px-4 py-3 sm:px-5">
        {icon}
        <h2 className="min-w-0 flex-1 truncate text-[17px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>
        {status && <div className="shrink-0 text-[13px] text-muted">{status}</div>}
      </header>
      <div className={`flex flex-1 flex-col p-4 sm:p-5 ${bodyClassName}`}>{children}</div>
    </section>
  );
}

/** Inline code / URL box. */
export function CodeBox({ children }: { children: ReactNode }) {
  return <code className="block break-all rounded-lg bg-fill px-2.5 py-2 font-mono text-[12.5px] text-ink">{children}</code>;
}
