import { BatteryCharging, Home, PlugZap, Sun, Zap, type LucideIcon } from "lucide-react";
import { SYS } from "@/components/ui";
import type { Flow, FlowLink } from "./flow";
import { watts } from "./flow";

/** Node colours (also used by the page legend). Solar yellow, grid blue, battery green, home indigo, like the iOS Home energy view. */
export const FLOW_COLOR = { solar: SYS.yellow, grid: SYS.blue, battery: SYS.green, home: SYS.indigo } as const;
const STYLE: Record<keyof typeof FLOW_COLOR, { color: string; label: string; Icon: LucideIcon; glyph: string }> = {
  solar: { color: FLOW_COLOR.solar, label: "Solar", Icon: Sun, glyph: "#1d1d1f" },
  grid: { color: FLOW_COLOR.grid, label: "Grid", Icon: PlugZap, glyph: "#ffffff" },
  battery: { color: FLOW_COLOR.battery, label: "Battery", Icon: BatteryCharging, glyph: "#ffffff" },
  home: { color: FLOW_COLOR.home, label: "Home", Icon: Home, glyph: "#ffffff" },
};
type Key = keyof typeof STYLE;
const KEYS = Object.keys(STYLE) as Key[];

/** Wide layout for desktop, a narrow one for phones (same user units → readable text). Top nodes print their text above, bottom nodes below. */
const LAYOUTS = {
  wide: { w: 640, h: 360, r: 26, inv: { x: 320, y: 190 }, pos: { solar: [150, 120], grid: [490, 120], battery: [150, 262], home: [490, 262] } },
  narrow: { w: 360, h: 372, r: 26, inv: { x: 180, y: 192 }, pos: { solar: [68, 120], grid: [292, 120], battery: [68, 262], home: [292, 262] } },
} as const;
type Layout = (typeof LAYOUTS)[keyof typeof LAYOUTS];
const INV_R = 38; // where links stop short of the inverter tile

function Link({ from, l, color, g }: { from: { x: number; y: number }; l: FlowLink; color: string; g: Layout }) {
  const INV = g.inv;
  const dx = INV.x - from.x, dy = INV.y - from.y;
  const len = Math.hypot(dx, dy);
  const ux = dx / len, uy = dy / len;
  const x1 = from.x + ux * (g.r + 8), y1 = from.y + uy * (g.r + 8);
  const x2 = INV.x - ux * INV_R, y2 = INV.y - uy * INV_R;
  const active = l.dir === "in" || l.dir === "out";
  // Dots travel from source to destination: toward the inverter when "in".
  const [ax, ay, bx, by] = l.dir === "out" ? [x2, y2, x1, y1] : [x1, y1, x2, y2];
  if (!active) return <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--color-line)" strokeWidth="3" strokeLinecap="round" strokeDasharray={l.dir === "unknown" ? "1 7" : undefined} />;
  return (
    <g>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={`color-mix(in srgb, ${color} 30%, transparent)`} strokeWidth="4" strokeLinecap="round" />
      <line x1={ax} y1={ay} x2={bx} y2={by} stroke={color} strokeWidth="6" strokeLinecap="round" strokeDasharray="0.1 14" className="ef-flow" />
    </g>
  );
}

/** Live energy flow between solar, battery, grid, home and the inverter, from the latest reading. */
export function EnergyFlow({ flow, inverter }: { flow: Flow; inverter: { word: string; problem: boolean } }) {
  return (
    <>
      <FlowSvg g={LAYOUTS.wide} flow={flow} inverter={inverter} className="hidden sm:block" />
      <FlowSvg g={LAYOUTS.narrow} flow={flow} inverter={inverter} className="sm:hidden" />
    </>
  );
}

function FlowSvg({ g, flow, inverter, className }: { g: Layout; flow: Flow; inverter: { word: string; problem: boolean }; className: string }) {
  const INV = g.inv, R = g.r;
  const node = (k: Key) => ({ x: g.pos[k][0], y: g.pos[k][1], ...STYLE[k] });
  return (
    <svg viewBox={`0 0 ${g.w} ${g.h}`} className={`mx-auto h-auto w-full max-w-[640px] ${className}`} role="img" aria-label="Energy flow right now" fontFamily="var(--font-sans)">
      <style>{`.ef-flow{animation:ef-flow 1s linear infinite}@keyframes ef-flow{to{stroke-dashoffset:-14.1}}@media (prefers-reduced-motion:reduce){.ef-flow{animation:none}}`}</style>
      {KEYS.map((k) => <Link key={k} from={node(k)} l={flow[k]} color={STYLE[k].color} g={g} />)}
      {KEYS.map((k) => {
        const n = node(k);
        const l = flow[k];
        const active = l.dir === "in" || l.dir === "out";
        const signed = k === "battery" && l.watts !== null && l.dir === "in" ? -Math.abs(l.watts) : l.watts === null ? null : Math.abs(l.watts);
        const above = n.y < INV.y;
        // Text block: label, watts, word. Above the circle for top nodes, below for bottom nodes.
        const ys = above ? [n.y - R - 50, n.y - R - 29, n.y - R - 12] : [n.y + R + 22, n.y + R + 43, n.y + R + 60];
        return (
          <g key={k}>
            <circle cx={n.x} cy={n.y} r={R} fill={active ? n.color : `color-mix(in srgb, ${n.color} 22%, var(--color-panel))`} />
            <n.Icon x={n.x - 13} y={n.y - 13} width={26} height={26} color={active ? n.glyph : n.color} strokeWidth={2.2} aria-hidden />
            <text x={n.x} y={ys[0]} textAnchor="middle" fontSize="14" fontWeight="600" fill="var(--color-muted)">{n.label}</text>
            <text x={n.x} y={ys[1]} textAnchor="middle" fontSize="20" fontWeight="700" fill="var(--color-ink)" style={{ fontVariantNumeric: "tabular-nums" }}>{watts(signed)}</text>
            <text x={n.x} y={ys[2]} textAnchor="middle" fontSize="13" fill="var(--color-muted)">{l.word}</text>
          </g>
        );
      })}
      <rect x={INV.x - 30} y={INV.y - 30} width="60" height="60" rx="16" fill="var(--color-panel-2)" stroke={inverter.problem ? "var(--color-critical)" : "var(--color-line)"} strokeWidth={inverter.problem ? 2.5 : 1} />
      <Zap x={INV.x - 13} y={INV.y - 13} width={26} height={26} color={inverter.problem ? "var(--color-critical)" : "var(--color-ink)"} strokeWidth={2} aria-hidden />
      <text x={INV.x} y={INV.y + 50} textAnchor="middle" fontSize="13" fontWeight="600" fill="var(--color-muted)">Inverter</text>
      <text x={INV.x} y={INV.y + 67} textAnchor="middle" fontSize="13" fontWeight="600" fill={inverter.problem ? "var(--color-critical)" : "var(--color-ink)"}>{inverter.word}</text>
    </svg>
  );
}

/** Battery state of charge as an Apple-style ring. */
export function BatteryRing({ soc, low, stored }: { soc: number | null; low: boolean; stored?: string | null }) {
  const r = 92, c = 2 * Math.PI * r;
  const pct = soc === null ? 0 : Math.max(0, Math.min(100, soc));
  const color = low ? SYS.orange : SYS.green;
  return (
    <svg viewBox="0 0 240 240" className="mx-auto h-auto w-full max-w-[200px] sm:max-w-[220px]" role="img" aria-label={soc === null ? "Battery charge not reported" : `Battery ${Math.round(pct)}%`} fontFamily="var(--font-sans)">
      <circle cx="120" cy="120" r={r} fill="none" stroke={soc === null ? "var(--color-fill)" : `color-mix(in srgb, ${color} 18%, transparent)`} strokeWidth="20" />
      {soc !== null && <circle cx="120" cy="120" r={r} fill="none" stroke={color} strokeWidth="20" strokeLinecap="round" strokeDasharray={`${(pct / 100) * c} ${c}`} transform="rotate(-90 120 120)" />}
      <text x="120" y="130" textAnchor="middle" fontSize="44" fontWeight="700" fill="var(--color-ink)" letterSpacing="-1" style={{ fontVariantNumeric: "tabular-nums" }}>{soc === null ? "—" : `${Math.round(pct)}%`}</text>
      <text x="120" y="156" textAnchor="middle" fontSize="14" fontWeight="600" fill={low ? "var(--color-warn)" : "var(--color-muted)"}>{low ? "Low" : stored ?? "Charge"}</text>
    </svg>
  );
}
