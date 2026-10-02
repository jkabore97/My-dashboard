import type { RingSegment } from "./logic";
import { SEV_COLOR, SEV_WORD } from "./hud";
import { businessColor } from "@/components/ui";

// The "system core": one ring segment per business. A segment turns red or
// orange only when that business has a critical or high open task, and then
// it also carries the severity's shape (diamond / triangle) outside the ring,
// so it reads without color. Everything else keeps its identity color.

const arc = (r1: number, r2: number, a0: number, a1: number) => {
  const p = (r: number, a: number) => `${(r * Math.cos(a)).toFixed(2)},${(r * Math.sin(a)).toFixed(2)}`;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${p(r2, a0)}A${r2},${r2} 0 ${large} 1 ${p(r2, a1)}L${p(r1, a1)}A${r1},${r1} 0 ${large} 0 ${p(r1, a0)}Z`;
};

const problem = (s: RingSegment) => s.worst === "critical" || s.worst === "high";

export function Reactor({ segments, attention, critical, href }: { segments: RingSegment[]; attention: number; critical: number; href: (business: string) => string }) {
  const n = segments.length;
  const g = n ? (2 * Math.PI) / n : 0;
  const pad = n > 1 ? Math.min(0.025, g * 0.08) : 0;
  return (
    <svg viewBox="-172 -172 344 344" className="h-auto w-full max-w-[330px] overflow-visible" role="img" aria-label={`${attention} items need attention, ${critical} critical, across ${n} businesses`}>
      <defs>
        <filter id="rx-gl" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <radialGradient id="rx-core">
          <stop offset="0" stopColor="#bdf3ff" stopOpacity=".9" />
          <stop offset=".45" stopColor="#3fd0ff" stopOpacity=".35" />
          <stop offset="1" stopColor="#3fd0ff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="rx-inner" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3fd0ff" />
          <stop offset=".5" stopColor="#a98bff" />
          <stop offset="1" stopColor="#ff5fd7" />
        </linearGradient>
      </defs>

      {Array.from({ length: 120 }, (_, i) => {
        const a = (i / 120) * 2 * Math.PI;
        const r1 = i % 10 === 0 ? 150 : 154;
        return <line key={i} x1={r1 * Math.cos(a)} y1={r1 * Math.sin(a)} x2={158 * Math.cos(a)} y2={158 * Math.sin(a)} stroke="rgb(63 208 255 / .45)" strokeWidth={i % 10 === 0 ? 1.5 : 0.8} />;
      })}
      <circle r="144" fill="none" stroke="rgb(63 208 255 / .25)" />

      {n === 0 && <circle r="125" fill="none" stroke="rgb(63 208 255 / .2)" strokeWidth="26" />}
      {segments.map((s, i) => {
        const a0 = -Math.PI / 2 + i * g + pad;
        const a1 = n === 1 ? a0 + 2 * Math.PI - 0.0001 : a0 + g - 2 * pad;
        const am = (a0 + a1) / 2;
        const bad = problem(s);
        const color = bad ? SEV_COLOR[s.worst!] : businessColor(s.business);
        const label = s.business.toUpperCase();
        const fits = Math.max(2, Math.floor((g * 125) / 6.2));
        const text = n === 1 ? label : label.length > fits ? `${label.slice(0, fits - 1)}…` : label;
        const tx = 125 * Math.cos(am);
        const ty = 125 * Math.sin(am);
        const rot = (am * 180) / Math.PI + (Math.sin(am) > 0.05 ? -90 : 90);
        const mx = 151 * Math.cos(am);
        const my = 151 * Math.sin(am);
        const summary = `${s.business}: ${s.open ? `${s.open} open${s.worst ? `, worst ${SEV_WORD[s.worst].toLowerCase()}` : ""}` : "nothing open"}`;
        return (
          <a key={s.business} href={href(s.business)} aria-label={summary}>
            <title>{summary}</title>
            <path d={arc(112, 138, a0, a1)} fill={color} opacity={bad ? 1 : 0.62} filter={bad ? "url(#rx-gl)" : undefined} className="transition-opacity hover:opacity-90" />
            {n > 1 && (
              <text x={tx} y={ty + 3} textAnchor="middle" fill={bad ? "#1a0a00" : "#04131d"} fontFamily="var(--font-display)" fontWeight="700" fontSize="8.5" letterSpacing=".5" transform={`rotate(${rot.toFixed(1)} ${tx.toFixed(1)} ${ty.toFixed(1)})`} pointerEvents="none">
                {text}
              </text>
            )}
            {s.worst === "critical" && <path d={`M${mx},${my - 6} L${mx + 6},${my} L${mx},${my + 6} L${mx - 6},${my} Z`} fill={color} filter="url(#rx-gl)" />}
            {s.worst === "high" && <path d={`M${mx},${my - 5.5} L${mx + 6},${my + 5} L${mx - 6},${my + 5} Z`} fill={color} filter="url(#rx-gl)" />}
          </a>
        );
      })}

      <circle r="100" fill="none" stroke="rgb(63 208 255 / .35)" strokeDasharray="2 6" />
      <circle r="88" fill="none" stroke="url(#rx-inner)" strokeWidth="6" opacity=".55" strokeDasharray="150 34" filter="url(#rx-gl)" transform="rotate(-80)" />
      <circle r="74" fill="url(#rx-core)" />
      <circle r="58" fill="rgb(4 10 16 / .88)" stroke="#3fd0ff" strokeWidth="1.5" filter="url(#rx-gl)" />
      <text y="-14" textAnchor="middle" fill="#7f97ab" fontFamily="var(--font-display)" fontWeight="600" fontSize="10" letterSpacing="2.5">ATTENTION</text>
      <text y="20" textAnchor="middle" fill="#eaf7ff" fontFamily="var(--font-display)" fontWeight="700" fontSize="34" filter="url(#rx-gl)" style={{ fontVariantNumeric: "tabular-nums" }}>{attention}</text>
      <text y="38" textAnchor="middle" fill={critical ? "#ff3d6e" : "#3df5a0"} fontFamily="var(--font-display)" fontWeight="700" fontSize="10" letterSpacing="2">{critical ? `${critical} CRITICAL` : "NONE CRITICAL"}</text>
    </svg>
  );
}

/** Legend under the ring: shape + color + word. */
export function ReactorLegend() {
  return (
    <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 font-display text-[12px] uppercase tracking-[0.12em] text-muted">
      <span className="inline-flex items-center gap-1.5"><i className="h-2 w-2" style={{ background: "linear-gradient(90deg,#3fd0ff,#a98bff)" }} />Nominal</span>
      <span className="inline-flex items-center gap-1.5"><svg width="10" height="10" viewBox="0 0 12 12" aria-hidden><path d="M6 1 11 11H1Z" fill={SEV_COLOR.high} /></svg>High</span>
      <span className="inline-flex items-center gap-1.5"><svg width="10" height="10" viewBox="0 0 12 12" aria-hidden><path d="M6 0 12 6 6 12 0 6Z" fill={SEV_COLOR.critical} /></svg>Critical</span>
    </div>
  );
}
