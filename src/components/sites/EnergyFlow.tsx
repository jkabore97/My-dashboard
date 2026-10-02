import type { Flow, FlowLink } from "./flow";
import { watts } from "./flow";

const STYLE = { solar: { color: "#c6f432", label: "Solar" }, grid: { color: "#3fd0ff", label: "Grid" }, battery: { color: "#3df5a0", label: "Battery" }, home: { color: "#ffd84d", label: "Home" } } as const;
type Key = keyof typeof STYLE;
const KEYS = Object.keys(STYLE) as Key[];

/** Wide layout for desktop, a narrow one for phones (same user units → readable text). */
const LAYOUTS = {
  wide: { w: 640, h: 380, r: 50, hex: 64, inv: { x: 320, y: 190 }, pos: { solar: [150, 86], grid: [490, 86], battery: [150, 296], home: [490, 296] } },
  narrow: { w: 360, h: 400, r: 52, hex: 56, inv: { x: 180, y: 200 }, pos: { solar: [62, 66], grid: [298, 66], battery: [62, 334], home: [298, 334] } },
} as const;
type Layout = (typeof LAYOUTS)[keyof typeof LAYOUTS];

function Link({ from, l, color, g }: { from: { x: number; y: number }; l: FlowLink; color: string; g: Layout }) {
  const INV = g.inv, R = g.r;
  const dx = INV.x - from.x, dy = INV.y - from.y;
  const len = Math.hypot(dx, dy);
  const ux = dx / len, uy = dy / len;
  const x1 = from.x + ux * R, y1 = from.y + uy * R;
  const x2 = INV.x - ux * (g.hex - 2), y2 = INV.y - uy * (g.hex * 0.82);
  const active = l.dir === "in" || l.dir === "out";
  // Dashes travel from source to destination: toward the inverter when "in".
  const [ax, ay, bx, by] = l.dir === "out" ? [x2, y2, x1, y1] : [x1, y1, x2, y2];
  return active ? (
    <line x1={ax} y1={ay} x2={bx} y2={by} stroke={color} strokeWidth="3" strokeDasharray="6 7" className="hud-flow" style={{ filter: `drop-shadow(0 0 4px ${color})` }} />
  ) : (
    <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeOpacity="0.28" strokeWidth="1.5" strokeDasharray={l.dir === "unknown" ? "2 5" : undefined} />
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
  const hex = Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    return `${(INV.x + g.hex * Math.cos(a)).toFixed(1)},${(INV.y + g.hex * Math.sin(a)).toFixed(1)}`;
  }).join(" ");
  const invColor = inverter.problem ? "#ff3d6e" : "#c6f432";
  const node = (k: Key) => ({ x: g.pos[k][0], y: g.pos[k][1], ...STYLE[k] });
  return (
    <svg viewBox={`0 0 ${g.w} ${g.h}`} className={`h-auto w-full ${className}`} role="img" aria-label="Energy flow right now">
      <style>{`.hud-flow{animation:hud-flow 1.1s linear infinite}@keyframes hud-flow{to{stroke-dashoffset:-26}}@media (prefers-reduced-motion:reduce){.hud-flow{animation:none}}`}</style>
      {KEYS.map((k) => <Link key={k} from={node(k)} l={flow[k]} color={STYLE[k].color} g={g} />)}
      {KEYS.map((k) => {
        const n = node(k);
        const l = flow[k];
        const active = l.dir === "in" || l.dir === "out";
        const signed = k === "battery" && l.watts !== null && l.dir === "in" ? -Math.abs(l.watts) : l.watts === null ? null : Math.abs(l.watts);
        return (
          <g key={k}>
            <circle cx={n.x} cy={n.y} r={R} fill={active ? `${n.color}14` : "#0b1626"} stroke={n.color} strokeOpacity={active ? 1 : 0.6} strokeWidth={active ? 2.5 : 1.5} strokeDasharray={active ? undefined : "4 4"} style={active ? { filter: `drop-shadow(0 0 8px ${n.color})` } : undefined} />
            <text x={n.x} y={n.y - 8} textAnchor="middle" fontSize="14" fill={n.color} letterSpacing="2.5" className="font-display" fontWeight="600">{n.label.toUpperCase()}</text>
            <text x={n.x} y={n.y + 14} textAnchor="middle" fontSize="15" fill="#ddebf5" className="font-mono">{watts(signed)}</text>
            <text x={n.x} y={n.y + 30} textAnchor="middle" fontSize="10.5" fill="#7f97ab" className="font-sans">{l.word}</text>
          </g>
        );
      })}
      <polygon points={hex} fill="#0b1626" stroke={invColor} strokeWidth="2" style={{ filter: `drop-shadow(0 0 8px ${invColor})` }} />
      <text x={INV.x} y={INV.y - 4} textAnchor="middle" fontSize={g.hex < 60 ? 12 : 13.5} fill={invColor} letterSpacing="2" className="font-display" fontWeight="600">INVERTER</text>
      <text x={INV.x} y={INV.y + 18} textAnchor="middle" fontSize="13" fill="#ddebf5" className="font-mono">{inverter.word}</text>
    </svg>
  );
}

/** Battery state of charge as a ring. */
export function BatteryRing({ soc, low, stored }: { soc: number | null; low: boolean; stored?: string | null }) {
  const r = 92, c = 2 * Math.PI * r;
  const pct = soc === null ? 0 : Math.max(0, Math.min(100, soc));
  const color = low ? "#ff9f1c" : "#c6f432";
  return (
    <svg viewBox="0 0 240 240" className="mx-auto h-auto w-full max-w-[200px] sm:max-w-[240px]" role="img" aria-label={soc === null ? "Battery charge not reported" : `Battery ${Math.round(pct)}%`}>
      <defs>
        <linearGradient id="soc-ring" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor={color} />
          <stop offset="1" stopColor={low ? "#ffc56b" : "#3df5a0"} />
        </linearGradient>
      </defs>
      <circle cx="120" cy="120" r={r + 12} fill="none" stroke="#c6f432" strokeOpacity="0.18" strokeDasharray="2 4" />
      <circle cx="120" cy="120" r={r} fill="none" stroke="#17304a" strokeWidth="12" />
      {soc !== null && <circle cx="120" cy="120" r={r} fill="none" stroke="url(#soc-ring)" strokeWidth="12" strokeLinecap="round" strokeDasharray={`${(pct / 100) * c} ${c}`} transform="rotate(-90 120 120)" style={{ filter: `drop-shadow(0 0 8px ${color})` }} />}
      <text x="120" y="128" textAnchor="middle" fontSize="46" fontWeight="700" fill="#eaf7ff" className="font-display">{soc === null ? "—" : `${Math.round(pct)}%`}</text>
      <text x="120" y="156" textAnchor="middle" fontSize="11" letterSpacing="2.5" fill={low ? "#ff9f1c" : "#7f97ab"} className="font-display">{low ? "LOW" : stored ?? "STATE OF CHARGE"}</text>
    </svg>
  );
}
