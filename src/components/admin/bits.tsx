import type { CSSProperties, ReactNode } from "react";

/** Identity color per platform (never red/orange: those mean "problem"). */
export const PLATFORM_COLOR: Record<string, string> = {
  microsoft: "#3fd0ff", github: "#a98bff", vercel: "#9be7ff", supabase: "#3df5a0", cloudflare: "#ffd84d", stripe: "#ffd84d",
  websites: "#2ef2d0", hikvision: "#c6f432", solar: "#c6f432", resend: "#ff5fd7", gmail: "#3fd0ff", claude: "#a98bff", reviews: "#ffd84d",
};

const MONO: Record<string, string> = { microsoft: "M", github: "GH", vercel: "▲", supabase: "S", cloudflare: "CF", stripe: "$", websites: "◎", hikvision: "H", solar: "☀", resend: "R", gmail: "G", claude: "✳", reviews: "★" };

/** A small square monogram for a platform card. */
export function Monogram({ id, name }: { id: string; name: string }) {
  const c = PLATFORM_COLOR[id] ?? "#3fd0ff";
  return (
    <span aria-hidden className="grid h-7 w-7 shrink-0 place-items-center font-display text-[11px] font-bold text-bg" style={{ background: `linear-gradient(135deg, ${c}, color-mix(in srgb, ${c} 55%, #ffffff))`, boxShadow: `0 0 10px color-mix(in srgb, ${c} 55%, transparent)` }}>
      {MONO[id] ?? name.slice(0, 1)}
    </span>
  );
}

/** A HUD panel whose header carries an icon, a title and a status chip. */
export function HeadPanel({ id, title, icon, status, accent, children, className = "", bodyClassName = "" }: { id?: string; title: ReactNode; icon?: ReactNode; status?: ReactNode; accent: string; children: ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section id={id} className={`hud-panel flex scroll-mt-24 flex-col ${className}`} style={{ "--a": accent } as CSSProperties}>
      <header className="hud-head flex items-center gap-3 px-4 py-3 sm:px-5">
        {icon}
        <h2 className="hud-title min-w-0 flex-1 truncate text-[13px]">{title}</h2>
        {status}
      </header>
      <div className={`flex flex-1 flex-col p-4 sm:p-5 ${bodyClassName}`}>{children}</div>
    </section>
  );
}

/** Inline code / URL box. */
export function CodeBox({ children }: { children: ReactNode }) {
  return <code className="block break-all bg-cyan/5 px-2.5 py-2 font-mono text-[12px] text-[#9be7ff]">{children}</code>;
}
