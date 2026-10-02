"use client";

import { useEffect, useRef, useState } from "react";

/** The container's width in CSS pixels, so chart text stays at its real size on phones. */
function useWidth(initial = 640) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

const LIME = "#c6f432";
const GOLD = "#ffd84d";
const GRID = "rgb(63 208 255 / 0.10)";
const AXIS = "#7f97ab";

const kw = (w: number) => (Math.abs(w) >= 1000 ? `${(w / 1000).toFixed(1)} kW` : `${Math.round(w)} W`);
const hhmm = (h: number) => `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.round((h % 1) * 60) % 60).padStart(2, "0")}`;

/** Points are hours of the day (business time zone, 0–24) and watts. */
export interface DayPoint { h: number; w: number }

/** Today's production (area) and home use (dashed line) on one watts axis, with a crosshair tooltip. */
export function ProductionChart({ solar, load, nowH }: { solar: DayPoint[]; load: DayPoint[]; nowH: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const [ref, W] = useWidth();
  const H = W < 480 ? 210 : 260, L = 40, R = 14, T = 26, B = 26;
  const maxW = Math.max(1000, ...solar.map((p) => p.w), ...load.map((p) => p.w));
  const top = Math.ceil(maxW / 1000) * 1000;
  const x = (h: number) => L + (h / 24) * (W - L - R);
  const y = (w: number) => T + (1 - w / top) * (H - T - B);
  const path = (pts: DayPoint[]) => pts.map((p, i) => `${i ? "L" : "M"}${x(p.h).toFixed(1)},${y(p.w).toFixed(1)}`).join("");
  const area = solar.length > 1 ? `${path(solar)}L${x(solar[solar.length - 1].h).toFixed(1)},${y(0)}L${x(solar[0].h).toFixed(1)},${y(0)}Z` : "";
  const ticks = Array.from({ length: Math.min(top / 1000, 6) + 1 }, (_, i) => (top / Math.min(top / 1000, 6)) * i);
  const nearest = (pts: DayPoint[], h: number) => pts.reduce<DayPoint | null>((best, p) => (!best || Math.abs(p.h - h) < Math.abs(best.h - h) ? p : best), null);
  const hs = hover === null ? null : nearest(solar, hover);
  const hl = hover === null ? null : nearest(load, hover);

  return (
    <div ref={ref} className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full touch-none"
        role="img"
        aria-label="Production and home use today"
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          setHover(Math.max(0, Math.min(24, ((px - L) / (W - L - R)) * 24)));
        }}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="solar-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={LIME} stopOpacity="0.35" />
            <stop offset="1" stopColor={LIME} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke={GRID} />
            <text x={L - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill={AXIS} className="font-mono">{t === 0 ? "0" : `${t / 1000}`}</text>
          </g>
        ))}
        <text x={4} y={12} fontSize="10" fill={AXIS} className="font-mono">kW</text>
        {(W < 420 ? [0, 12, 24] : [0, 6, 12, 18, 24]).map((h) => <text key={h} x={x(h)} y={H - 6} textAnchor="middle" fontSize="11" fill={AXIS} className="font-mono">{String(h).padStart(2, "0")}</text>)}
        {area && <path d={area} fill="url(#solar-fill)" />}
        {solar.length > 1 && <path d={path(solar)} fill="none" stroke={LIME} strokeWidth="2" strokeLinejoin="round" style={{ filter: `drop-shadow(0 0 4px ${LIME})` }} />}
        {load.length > 1 && <path d={path(load)} fill="none" stroke={GOLD} strokeWidth="1.6" strokeDasharray="4 4" />}
        <line x1={x(nowH)} x2={x(nowH)} y1={T} y2={H - B} stroke="#3fd0ff" strokeDasharray="2 3" />
        <text x={Math.min(x(nowH), W - R - 2)} y={T - 4} textAnchor={x(nowH) > W - 80 ? "end" : "middle"} fontSize="10.5" fill="#3fd0ff" className="font-mono">now {hhmm(nowH)}</text>
        {hover !== null && (
          <g pointerEvents="none">
            <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} stroke="#ddebf5" strokeOpacity="0.35" />
            {hs && <circle cx={x(hs.h)} cy={y(hs.w)} r="4" fill={LIME} stroke="#0b1626" strokeWidth="2" />}
            {hl && <circle cx={x(hl.h)} cy={y(hl.w)} r="4" fill={GOLD} stroke="#0b1626" strokeWidth="2" />}
          </g>
        )}
      </svg>
      {hover !== null && (hs || hl) && (
        <div className="pointer-events-none absolute top-2 rounded-sm border border-line bg-panel/95 px-2.5 py-1.5 text-xs shadow-lg" style={{ left: `${Math.min(70, Math.max(8, (x(hover) / W) * 100))}%` }}>
          <div className="font-mono text-muted tabular-nums">{hhmm((hs ?? hl)!.h)}</div>
          {hs && <div className="tabular-nums"><span className="mr-1.5 inline-block h-0.5 w-3 align-middle" style={{ background: LIME }} />Solar {kw(hs.w)}</div>}
          {hl && <div className="tabular-nums"><span className="mr-1.5 inline-block h-0.5 w-3 align-middle" style={{ background: GOLD }} />Home {kw(hl.w)}</div>}
        </div>
      )}
    </div>
  );
}

/** Energy per day: one bar per day, today highlighted, with the period average as a dashed line. */
export function DailyBars({ days }: { days: { date: string; value: number; label: string }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [ref, W] = useWidth();
  const H = W < 480 ? 210 : 260, L = 34, R = 10, T = 22, B = 26;
  const max = Math.max(1, ...days.map((d) => d.value));
  const step = max > 40 ? 20 : max > 16 ? 8 : max > 8 ? 4 : 2;
  const top = Math.ceil(max / step) * step;
  const avg = days.reduce((s, d) => s + d.value, 0) / days.length;
  const slot = (W - L - R) / days.length;
  const bw = Math.min(34, Math.max(6, slot - 8));
  const y = (v: number) => T + (1 - v / top) * (H - T - B);
  const labelEvery = days.length > 8 ? (W < 480 ? 4 : 3) : 1;
  return (
    <div ref={ref} className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Energy produced per day" onPointerLeave={() => setHover(null)}>
        <defs>
          <linearGradient id="day-bar" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={LIME} />
            <stop offset="1" stopColor="#3df5a0" stopOpacity="0.45" />
          </linearGradient>
        </defs>
        {Array.from({ length: top / step + 1 }, (_, i) => i * step).map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke={GRID} />
            <text x={L - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill={AXIS} className="font-mono">{t}</text>
          </g>
        ))}
        {days.map((d, i) => {
          const last = i === days.length - 1;
          const bx = L + i * slot + (slot - bw) / 2;
          return (
            <g key={d.date} onPointerEnter={() => setHover(i)}>
              <rect x={L + i * slot} y={T} width={slot} height={H - T - B} fill="transparent" />
              <path
                d={`M${bx},${y(0)}V${y(d.value) + 3}q0,-3 3,-3h${bw - 6}q3,0 3,3V${y(0)}Z`}
                fill={last ? LIME : "url(#day-bar)"}
                opacity={hover === null || hover === i ? 1 : 0.55}
                style={last ? { filter: `drop-shadow(0 0 6px ${LIME})` } : undefined}
              />
              {last && <text x={bx + bw / 2} y={y(d.value) - 6} textAnchor="middle" fontSize="11" fill="#ddebf5" className="font-mono">{d.value}</text>}
              {(last || (days.length - 1 - i) % labelEvery === 0) && i !== days.length - 2 && (
                <text x={bx + bw / 2} y={H - 6} textAnchor="middle" fontSize="11" fill={AXIS} className="font-mono">{last ? "Today" : d.label}</text>
              )}
            </g>
          );
        })}
        <line x1={L} x2={W - R} y1={y(avg)} y2={y(avg)} stroke="#ddebf5" strokeOpacity="0.45" strokeDasharray="5 5" pointerEvents="none" />
      </svg>
      {hover !== null && (
        <div className="pointer-events-none absolute top-1 rounded-sm border border-line bg-panel/95 px-2.5 py-1.5 text-xs shadow-lg" style={{ left: `${Math.min(72, Math.max(4, ((L + hover * slot) / W) * 100))}%` }}>
          <div className="font-mono text-muted">{days[hover].date}</div>
          <div className="tabular-nums">{days[hover].value} kWh</div>
        </div>
      )}
    </div>
  );
}
