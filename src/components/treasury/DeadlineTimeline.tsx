import type { CSSProperties } from "react";
import { addDays, addMonths, daysBetween, formatDate } from "@/lib/dates";

/**
 * The next ~100 days on one axis, with a pin per deadline and its label above
 * or below in alternating lanes. Hidden on phones (the list below says the
 * same thing).
 */
export function DeadlineTimeline({ today, pins }: { today: string; pins: { id: string; date: string; label: string; color: string }[] }) {
  const start = addDays(today, -7);
  const span = 107;
  const pos = (date: string) => Math.max(0.5, Math.min(99.5, (daysBetween(start, date) / span) * 100));
  const months: string[] = [];
  for (let m = addMonths(`${start.slice(0, 7)}-01`, 1); daysBetween(start, m) < span; m = addMonths(m, 1)) months.push(m);
  const AXIS = 84;
  const LANES = [8, 34, 112, 138]; // label tops: above far, above near, below near, below far
  const order = [1, 2, 0, 3];
  const short = (d: string) => formatDate(d).replace(/, \d{4}$/, "");

  return (
    <div className="hidden px-5 pb-4 pt-3 md:block" aria-label="Deadlines on a timeline">
      <div className="relative mx-1.5 h-[178px]">
        <div className="absolute inset-x-0 h-0.5" style={{ top: AXIS, background: "linear-gradient(90deg, #ff3d6e, #ff9f1c 8%, #3fd0ff 20%, #a98bff 60%, #ff5fd7)" }} />
        {months.map((m) => (
          <div key={m}>
            <div className="absolute h-2.5 w-px bg-cyan/50" style={{ top: AXIS - 4, left: `${pos(m)}%` }} />
            <div className="hud-label absolute -translate-x-1/2 text-[11px] text-muted" style={{ top: 158, left: `${pos(m)}%` }}>{new Date(`${m}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short" })}</div>
          </div>
        ))}
        <div className="absolute w-0.5 bg-[#eaf7ff] shadow-[0_0_10px_#eaf7ff]" style={{ top: AXIS - 14, height: 30, left: `${pos(today)}%` }}>
          <span className="hud-label absolute -top-4 left-1.5 whitespace-nowrap text-[10px] text-[#eaf7ff]">Today</span>
        </div>
        {pins.map((p, i) => {
          const top = LANES[order[i % 4]];
          const above = top < AXIS;
          const left = pos(p.date);
          const right = left > 66;
          const c = { "--c": p.color } as CSSProperties;
          return (
            <div key={p.id} style={c}>
              <div className="absolute w-px" style={{ left: `${left}%`, top: above ? top + 20 : AXIS + 7, height: above ? AXIS - 5 - (top + 20) : top - AXIS - 7, background: "linear-gradient(var(--c), color-mix(in srgb, var(--c) 30%, transparent))" }} />
              <div className="absolute h-3 w-3 -translate-x-1/2 rotate-45" style={{ left: `${left}%`, top: AXIS - 5, background: "var(--c)", boxShadow: "0 0 10px var(--c)" }} />
              <div
                className={`absolute max-w-[42%] truncate whitespace-nowrap px-2 py-0.5 font-display text-xs font-semibold tracking-[0.05em] ${right ? "-translate-x-full border-r-2" : "border-l-2"}`}
                style={{ left: `${left}%`, top, color: "var(--c)", borderColor: "var(--c)", background: "color-mix(in srgb, var(--c) 10%, transparent)" }}
                title={`${short(p.date)} · ${p.label}`}
              >
                {short(p.date)}<em className="ml-1.5 font-sans font-medium not-italic tracking-normal text-[#eaf7ff]">{p.label}</em>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
