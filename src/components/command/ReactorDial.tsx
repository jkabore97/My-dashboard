"use client";

import { useEffect, useRef, useState, useTransition, type KeyboardEvent, type PointerEvent } from "react";
import { useRouter } from "next/navigation";
import type { RingSegment } from "./logic";
import { SEV_COLOR, SEV_WORD } from "./hud";
import { businessColor } from "@/components/ui";
import { setBusinessFilter } from "@/app/actions/view";

// The "system core" as a dial: spin the ring (drag/swipe, tap a segment, or
// arrow keys) to bring a business under the marker at the top; the centre
// then shows that business, and tapping the centre focuses the whole
// dashboard on it (tap again to show every business). A segment is red or
// orange only when that business has a critical or high open task, and then
// also carries the severity's shape outside the ring, so it reads without color.

const arc = (r1: number, r2: number, a0: number, a1: number) => {
  const p = (r: number, a: number) => `${(r * Math.cos(a)).toFixed(2)},${(r * Math.sin(a)).toFixed(2)}`;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${p(r2, a0)}A${r2},${r2} 0 ${large} 1 ${p(r2, a1)}L${p(r1, a1)}A${r1},${r1} 0 ${large} 0 ${p(r1, a0)}Z`;
};

const problem = (s: RingSegment) => s.worst === "critical" || s.worst === "high";
const TAU = 2 * Math.PI;
/** Rotation (radians) that puts segment i's middle under the top marker. */
const rotationFor = (i: number, n: number) => -((i + 0.5) * TAU) / n;
// Server and browser trig can differ in the last digit: round so hydration matches.
const f = (v: number) => v.toFixed(2);
const norm = (a: number) => ((a % TAU) + TAU) % TAU;

function nearest(rotation: number, n: number) {
  // Segment middle i sits at (i + .5)·g + rotation from the top; pick the one closest to 0.
  const g = TAU / n;
  return ((Math.round(norm(-rotation) / g - 0.5) % n) + n) % n;
}

export function ReactorDial({ segments, attention, critical, focused, focusable }: { segments: RingSegment[]; attention: number; critical: number; focused: string | null; /** Businesses the top-bar filter accepts; others (e.g. Unassigned) open their to-dos instead. */ focusable: string[] }) {
  const router = useRouter();
  const n = segments.length;
  const g = n ? TAU / n : 0;
  const pad = n > 1 ? Math.min(0.025, g * 0.08) : 0;
  const start = focused ? segments.findIndex((s) => s.business === focused) : -1;
  const [rotation, setRotation] = useState(start >= 0 ? rotationFor(start, n) : 0);
  // Nothing is "picked" until the person spins or taps, unless a business is already focused.
  const [picked, setPicked] = useState(start >= 0);
  const [animate, setAnimate] = useState(true);
  const [pending, startTransition] = useTransition();
  const svgRef = useRef<SVGSVGElement>(null);
  // Latest rendered rotation, for handlers that run after a drag.
  const rotRef = useRef(rotation);
  rotRef.current = rotation;
  const drag = useRef<{ id: number; touch: boolean; lastA: number; lastX: number; moved: number; v: number; t: number } | null>(null);
  const spin = useRef<number | null>(null);
  const lastIndex = useRef<number>(-1);

  const selected = picked && n ? segments[nearest(rotation, n)] : null;

  const angleAt = (e: PointerEvent) => {
    const box = svgRef.current!.getBoundingClientRect();
    return Math.atan2(e.clientY - (box.top + box.height / 2), e.clientX - (box.left + box.width / 2));
  };
  /** A light tick on phones each time a new business passes the marker. */
  const tick = (r: number) => {
    const i = nearest(r, n);
    if (i !== lastIndex.current) {
      lastIndex.current = i;
      try {
        navigator.vibrate?.(6);
      } catch {
        /* not supported */
      }
    }
  };
  const stopSpin = () => {
    if (spin.current !== null) cancelAnimationFrame(spin.current);
    spin.current = null;
  };
  const snapTo = (i: number) => {
    stopSpin();
    // Turn the shortest way to segment i.
    const target = rotationFor(i, n);
    const delta = norm(target - rotRef.current + Math.PI) - Math.PI;
    lastIndex.current = i;
    setAnimate(true);
    setRotation(rotRef.current + delta);
    setPicked(true);
  };
  useEffect(() => () => { if (spin.current !== null) cancelAnimationFrame(spin.current); }, []);
  const step = (by: number) => {
    if (!n) return;
    const cur = picked ? nearest(rotRef.current, n) : by > 0 ? -1 : 0;
    snapTo((cur + by + n) % n);
  };

  const onDown = (e: PointerEvent<SVGSVGElement>) => {
    if (!n || (e.target as Element).closest("[data-core]")) return;
    stopSpin();
    drag.current = { id: e.pointerId, touch: e.pointerType !== "mouse", lastA: angleAt(e), lastX: e.clientX, moved: 0, v: 0, t: e.timeStamp };
    setAnimate(false);
  };
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    // Touch: a left/right swipe turns the ring like a wheel (vertical swipes still scroll the page).
    // Mouse: follow the pointer around the centre.
    let delta: number;
    if (d.touch) {
      const radius = (svgRef.current?.getBoundingClientRect().width ?? 300) * 0.36;
      delta = (e.clientX - d.lastX) / radius;
      d.lastX = e.clientX;
    } else {
      const a = angleAt(e);
      delta = norm(a - d.lastA + Math.PI) - Math.PI;
      d.lastA = a;
    }
    const dt = Math.max(1, e.timeStamp - d.t);
    d.t = e.timeStamp;
    d.v = 0.7 * d.v + 0.3 * (delta / dt);
    d.moved += Math.abs(delta);
    if (d.moved > 0.04) {
      svgRef.current?.setPointerCapture(e.pointerId);
      const r = rotRef.current + delta;
      rotRef.current = r;
      setRotation(r);
      setPicked(true);
      tick(r);
    }
  };
  const onUp = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.id !== e.pointerId) return;
    if (d.moved > 0.04) {
      // Fling: keep turning and slow down, then settle on the nearest business.
      let v = Math.max(-0.03, Math.min(0.03, d.v));
      if (Math.abs(v) < 0.0012) return snapTo(nearest(rotRef.current, n));
      let last = performance.now();
      const frame = (now: number) => {
        const dt = Math.min(48, now - last);
        last = now;
        v *= Math.pow(0.94, dt / 16);
        const r = rotRef.current + v * dt;
        rotRef.current = r;
        setRotation(r);
        tick(r);
        if (Math.abs(v) < 0.0012) return snapTo(nearest(r, n));
        spin.current = requestAnimationFrame(frame);
      };
      spin.current = requestAnimationFrame(frame);
      return;
    }
    // A tap on a segment brings it to the top.
    const seg = (e.target as Element).closest("[data-seg]")?.getAttribute("data-seg");
    if (seg !== null && seg !== undefined) snapTo(Number(seg));
  };

  const choose = () => {
    if (!selected || pending) return;
    if (focused === selected.business) return startTransition(() => setBusinessFilter(null));
    if (!focusable.includes(selected.business)) return router.push(`/tasks?business=${encodeURIComponent(selected.business)}`);
    startTransition(() => setBusinessFilter(selected.business));
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (!n) return;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); step(1); }
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); step(-1); }
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(); }
  };

  const isFocused = !!selected && focused === selected.business;
  const name = selected?.business.toUpperCase() ?? "";
  // Split the name into at most two lines at word boundaries (13 characters each, truncated).
  const words = name.split(/\s+/).filter(Boolean);
  const first: string[] = [];
  while (words.length && [...first, words[0]].join(" ").length <= 13) first.push(words.shift()!);
  if (!first.length && words.length) first.push(words.shift()!.slice(0, 12) + "…");
  const rest = words.join(" ");
  const nameLines = [first.join(" "), rest];
  const second = rest.length > 13 ? `${rest.slice(0, 12)}…` : rest;

  return (
    <div className="flex w-full flex-col items-center">
      <svg
        ref={svgRef}
        viewBox="-172 -172 344 344"
        className="h-auto w-full max-w-[330px] cursor-grab touch-pan-y select-none overflow-visible rounded-full outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan active:cursor-grabbing"
        role="group"
        tabIndex={0}
        aria-label={`Business dial: ${n} businesses. Use arrow keys to turn, Enter to focus the dashboard on the business at the top.`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => { const was = drag.current; drag.current = null; if (n && was && was.moved > 0.04) snapTo(nearest(rotRef.current, n)); }}
        onKeyDown={onKey}
      >
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
          const a = (i / 120) * TAU;
          const r1 = i % 10 === 0 ? 150 : 154;
          return <line key={i} x1={f(r1 * Math.cos(a))} y1={f(r1 * Math.sin(a))} x2={f(158 * Math.cos(a))} y2={f(158 * Math.sin(a))} stroke="rgb(63 208 255 / .45)" strokeWidth={i % 10 === 0 ? 1.5 : 0.8} />;
        })}
        <circle r="144" fill="none" stroke="rgb(63 208 255 / .25)" />

        {/* Marker at the top: the business under it is the one in the centre. */}
        {n > 0 && <path d="M0,-164 L7,-176 L-7,-176 Z" fill="#eaf7ff" filter="url(#rx-gl)" opacity={picked ? 1 : 0.45} />}

        {n === 0 && <circle r="125" fill="none" stroke="rgb(63 208 255 / .2)" strokeWidth="26" />}
        <g style={{ transform: `rotate(${rotation}rad)`, transition: animate ? "transform .45s cubic-bezier(.2,.8,.2,1)" : "none" }}>
          {segments.map((s, i) => {
            const a0 = -Math.PI / 2 + i * g + pad;
            const a1 = n === 1 ? a0 + TAU - 0.0001 : a0 + g - 2 * pad;
            const am = (a0 + a1) / 2;
            const bad = problem(s);
            const isSel = selected?.business === s.business;
            const color = bad ? SEV_COLOR[s.worst!] : businessColor(s.business);
            const label = s.business.toUpperCase();
            const fits = Math.max(2, Math.floor((g * 125) / 6.2));
            const text = n === 1 ? label : label.length > fits ? `${label.slice(0, fits - 1)}…` : label;
            const tx = +f(125 * Math.cos(am));
            const ty = +f(125 * Math.sin(am));
            // Keep labels upright wherever the ring has turned.
            const abs = am + rotation;
            const rot = (am * 180) / Math.PI + (Math.sin(abs) > 0.05 ? -90 : 90);
            const mx = +f(151 * Math.cos(am));
            const my = +f(151 * Math.sin(am));
            const summary = `${s.business}: ${s.open ? `${s.open} open${s.worst ? `, worst ${SEV_WORD[s.worst].toLowerCase()}` : ""}` : "nothing open"}`;
            return (
              <g key={s.business} data-seg={i} className="cursor-pointer">
                <title>{summary}</title>
                <path d={arc(isSel ? 110 : 112, isSel ? 141 : 138, a0, a1)} fill={color} opacity={bad || isSel ? 1 : picked ? 0.42 : 0.62} filter={bad || isSel ? "url(#rx-gl)" : undefined} stroke={isSel ? "#eaf7ff" : "none"} strokeWidth={isSel ? 1.2 : 0} />
                {n > 1 && (
                  <text x={tx} y={ty + 3} textAnchor="middle" fill={bad ? "#1a0a00" : "#04131d"} fontFamily="var(--font-display)" fontWeight="700" fontSize="8.5" letterSpacing=".5" transform={`rotate(${rot.toFixed(1)} ${tx.toFixed(1)} ${ty.toFixed(1)})`} pointerEvents="none">
                    {text}
                  </text>
                )}
                {s.worst === "critical" && <path d={`M${mx},${my - 6} L${mx + 6},${my} L${mx},${my + 6} L${mx - 6},${my} Z`} fill={color} filter="url(#rx-gl)" />}
                {s.worst === "high" && <path d={`M${mx},${my - 5.5} L${mx + 6},${my + 5} L${mx - 6},${my + 5} Z`} fill={color} filter="url(#rx-gl)" />}
              </g>
            );
          })}
        </g>

        <circle r="100" fill="none" stroke="rgb(63 208 255 / .35)" strokeDasharray="2 6" />
        <circle r="88" fill="none" stroke="url(#rx-inner)" strokeWidth="6" opacity=".55" strokeDasharray="150 34" filter="url(#rx-gl)" transform="rotate(-80)" />
        <circle r="74" fill="url(#rx-core)" />

        {/* The centre: overall attention, or the business under the marker (tap to focus). */}
        <g data-core role="button" aria-label={selected ? (isFocused ? `Show all businesses` : `Focus the dashboard on ${selected.business}`) : undefined}
          className={selected ? "cursor-pointer" : ""} onClick={choose} opacity={pending ? 0.6 : 1}>
          <circle r="58" fill="rgb(4 10 16 / .9)" stroke={selected ? businessColor(selected.business) : "#3fd0ff"} strokeWidth={selected ? 2 : 1.5} filter="url(#rx-gl)" />
          {selected ? (
            <>
              <text y={second ? -24 : -18} textAnchor="middle" fill="#eaf7ff" fontFamily="var(--font-display)" fontWeight="700" fontSize="11" letterSpacing="1.2">{nameLines[0]}</text>
              {second && <text y="-11" textAnchor="middle" fill="#eaf7ff" fontFamily="var(--font-display)" fontWeight="700" fontSize="11" letterSpacing="1.2">{second}</text>}
              <text y="14" textAnchor="middle" fill={selected.worst === "critical" || selected.worst === "high" ? SEV_COLOR[selected.worst] : "#eaf7ff"} fontFamily="var(--font-display)" fontWeight="700" fontSize="24" style={{ fontVariantNumeric: "tabular-nums" }}>{selected.open}</text>
              <text y="27" textAnchor="middle" fill="#7f97ab" fontFamily="var(--font-display)" fontWeight="600" fontSize="7.5" letterSpacing="1.5">
                {selected.critical ? `${selected.critical} CRITICAL · ` : selected.high ? `${selected.high} HIGH · ` : ""}OPEN
              </text>
              <text y="42" textAnchor="middle" fill={isFocused ? "#ffd84d" : "#3fd0ff"} fontFamily="var(--font-display)" fontWeight="700" fontSize="7.5" letterSpacing="1.5">
                {pending ? "…" : isFocused ? "TAP FOR ALL" : focusable.includes(selected.business) ? "TAP TO FOCUS" : "TAP FOR TO-DOS"}
              </text>
            </>
          ) : (
            <>
              <text y="-14" textAnchor="middle" fill="#7f97ab" fontFamily="var(--font-display)" fontWeight="600" fontSize="10" letterSpacing="2.5">ATTENTION</text>
              <text y="20" textAnchor="middle" fill="#eaf7ff" fontFamily="var(--font-display)" fontWeight="700" fontSize="34" filter="url(#rx-gl)" style={{ fontVariantNumeric: "tabular-nums" }}>{attention}</text>
              <text y="38" textAnchor="middle" fill={critical ? "#ff3d6e" : "#3df5a0"} fontFamily="var(--font-display)" fontWeight="700" fontSize="10" letterSpacing="2">{critical ? `${critical} CRITICAL` : "NONE CRITICAL"}</text>
            </>
          )}
        </g>
      </svg>
      {n > 1 && (
        <div className="mt-2 flex w-full max-w-[330px] items-center gap-2">
          <button type="button" onClick={() => step(-1)} aria-label="Previous business" className="hud-btn h-11 w-11 shrink-0 px-0 text-base">◀</button>
          <button type="button" onClick={choose} disabled={!selected || pending}
            className="hud-cut min-h-11 min-w-0 flex-1 truncate border border-line bg-panel/60 px-2 font-display text-[12px] font-semibold uppercase tracking-[0.12em]"
            style={selected ? { color: businessColor(selected.business), borderColor: businessColor(selected.business) } : { color: "#7f97ab" }}>
            {selected ? (isFocused ? `Showing ${selected.business} · all` : selected.business) : "Swipe the ring"}
          </button>
          <button type="button" onClick={() => step(1)} aria-label="Next business" className="hud-btn h-11 w-11 shrink-0 px-0 text-base">▶</button>
        </div>
      )}
    </div>
  );
}
