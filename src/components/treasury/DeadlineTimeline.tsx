import type { CSSProperties } from "react";
import { addDays, addMonths, daysBetween, formatDate } from "@/lib/dates";
import { appleColor, readable, tint } from "@/components/ui";

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
        <div className="absolute inset-x-0 h-0.5 rounded-full bg-line" style={{ top: AXIS }} />
        {months.map((m) => (
          <div key={m}>
            <div className="absolute h-2.5 w-px bg-line" style={{ top: AXIS - 4, left: `${pos(m)}%` }} />
            <div className="absolute -translate-x-1/2 text-[12px] text-muted" style={{ top: 158, left: `${pos(m)}%` }}>{new Date(`${m}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short" })}</div>
          </div>
        ))}
        <div className="absolute w-0.5 rounded-full bg-cyan" style={{ top: AXIS - 14, height: 30, left: `${pos(today)}%` }}>
          <span className="absolute -top-4 left-1.5 whitespace-nowrap text-[12px] font-semibold text-cyan">Today</span>
        </div>
        {pins.map((p, i) => {
          const top = LANES[order[i % 4]];
          const above = top < AXIS;
          const left = pos(p.date);
          const right = left > 66;
          const color = appleColor(p.color);
          const c = { "--c": color } as CSSProperties;
          return (
            <div key={p.id} style={c}>
              <div className="absolute w-px bg-line" style={{ left: `${left}%`, top: above ? top + 22 : AXIS + 7, height: above ? AXIS - 5 - (top + 22) : top - AXIS - 7 }} />
              <div className="absolute h-3 w-3 -translate-x-1/2 rounded-full ring-2 ring-panel" style={{ left: `${left}%`, top: AXIS - 5, background: "var(--c)" }} />
              <div
                className={`absolute max-w-[42%] truncate whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${right ? "-translate-x-full" : ""}`}
                style={{ left: `${left}%`, top, color: readable(color), background: tint(color, 14) }}
                title={`${short(p.date)} · ${p.label}`}
              >
                {short(p.date)}<em className="ml-1.5 font-normal not-italic text-ink">{p.label}</em>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
