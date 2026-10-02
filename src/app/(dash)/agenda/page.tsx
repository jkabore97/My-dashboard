import { requireSection } from "@/lib/server/auth";
import type { CSSProperties } from "react";
import { Video } from "lucide-react";
import { getDashboard } from "@/lib/server/dashboard";
import { addDays, businessTimeZone, today } from "@/lib/dates";
import { clockZones } from "@/lib/server/clocks";
import { Card, Empty, PageHeader, businessColor } from "@/components/ui";
import type { CalendarEvent } from "@/lib/types";
import { eventDay } from "@/lib/agenda";
import { Countdown } from "@/components/command/Countdown";
import { KV } from "@/components/command/hud";
import { calendarSummary, formatMinutes, meetingStats, nextEvent } from "@/components/command/logic";

/** Hour of day (fractional) in a time zone. */
function hourIn(tz: string, at: number) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h + m / 60;
}

/** Hours zone B is ahead of zone A right now (can be fractional or negative). */
function offsetHours(a: string, b: string, at: number) {
  let d = hourIn(b, at) - hourIn(a, at);
  if (d > 12) d -= 24;
  if (d < -12) d += 24;
  return d;
}

const joinLabel = (url: string) => (/meet\.google/.test(url) ? "Join Meet" : /teams\.(microsoft|live)/.test(url) ? "Join Teams" : /zoom\.us/.test(url) ? "Join Zoom" : "Join");
const WORK_FROM = 9;
const WORK_TO = 17;

export default async function AgendaPage() {
  await requireSection("agenda");
  const d = await getDashboard();
  const tz = businessTimeZone();
  const now = today(tz);
  const nowMs = Date.now();
  const other = clockZones().find((z) => z.timeZone !== tz) ?? null;
  const short = other ? other.label.slice(0, 3).toUpperCase() : "";
  const time = (iso: string, zone = tz) => new Date(iso).toLocaleTimeString("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit" });
  const range = (e: CalendarEvent, zone = tz) => `${time(e.start, zone)} – ${time(e.end, zone)}`;

  const days = new Map<string, CalendarEvent[]>();
  for (const e of d.calendar) {
    const day = eventDay(e, tz);
    if (day < now) continue;
    days.set(day, [...(days.get(day) ?? []), e]);
  }
  const sorted = [...days].sort(([a], [b]) => a.localeCompare(b));
  const upcoming = sorted.flatMap(([, ev]) => ev);
  const label = (day: string) => {
    const s = new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long", month: "short", day: "numeric" });
    return day === now ? `Today · ${s}` : s;
  };
  const week = Array.from({ length: 7 }, (_, i) => addDays(now, i));
  const next = nextEvent(upcoming, nowMs);
  const cals = calendarSummary(upcoming);
  const stats = meetingStats(upcoming.filter((e) => eventDay(e, tz) <= week[6]));
  const outside = other ? upcoming.filter((e) => !e.allDay && (() => { const h = hourIn(other.timeZone, Date.parse(e.start)); return h < WORK_FROM || h >= WORK_TO; })()).length : 0;
  const calColor = (e: Pick<CalendarEvent, "calendar">) => businessColor(e.calendar);

  // Time-zone bridge: both cities' 9-to-5 on one 24-hour scale in the business zone.
  const off = other ? offsetHours(tz, other.timeZone, nowMs) : 0;
  const nowH = hourIn(tz, nowMs);
  const theirs = { from: (((WORK_FROM - off) % 24) + 24) % 24, to: (((WORK_TO - off) % 24) + 24) % 24 };
  // Their working day may wrap past midnight on our clock: check each piece against our 9-to-5.
  const pieces = theirs.from < theirs.to ? [[theirs.from, theirs.to]] : [[theirs.from, 24], [0, theirs.to]];
  const overlap = pieces.map(([a, b]) => ({ from: Math.max(WORK_FROM, a), to: Math.min(WORK_TO, b) })).find((o) => o.to > o.from) ?? null;
  const hasOverlap = !!overlap;
  const hh = (h: number) => { const H = Math.floor(h); const M = Math.round((h - H) * 60); const d0 = new Date(Date.UTC(2000, 0, 1, H, M)); return d0.toLocaleTimeString("en-US", { timeZone: "UTC", hour: "numeric", minute: M ? "2-digit" : undefined }); };
  const band = (from: number, to: number) => (from < to ? [{ l: from, w: to - from }] : [{ l: from, w: 24 - from }, { l: 0, w: to }]);

  return (
    <>
      <PageHeader mode={d.modes.calendar} title="Agenda" subtitle={`The next 7 days from every connected Google and Outlook calendar. Times in ${tz}${other ? `, with ${other.label} alongside` : ""}.`} />

      {sorted.length === 0 ? (
        <Card><Empty>Nothing scheduled. Connect Google or Microsoft 365 on the Platforms page to see your meetings.</Empty></Card>
      ) : (
        <>
          <div className={`mb-4 grid gap-4 lg:mb-[22px] lg:gap-[22px] ${other ? "xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]" : ""}`}>
            <Card title={next?.inProgress ? "Happening now" : "Next up"} accent="cyan" flush action={next ? `${next.event.calendar} · ${next.event.provider === "google" ? "Google" : "Outlook"}` : undefined}>
              {next ? (
                <div className="grid grid-cols-[96px_minmax(0,1fr)] items-center gap-4 px-4 py-5 sm:grid-cols-[150px_minmax(0,1fr)] sm:px-5">
                  <Countdown to={next.event.start} until={next.event.end} />
                  <div className="min-w-0">
                    <div className="break-words text-[17px] font-medium leading-snug">{next.event.url ? <a href={next.event.url} target="_blank" rel="noreferrer" className="hover:text-cyan">{next.event.title}</a> : next.event.title}</div>
                    <div className="mt-0.5 truncate text-[12.5px] text-muted">{[next.event.location, label(eventDay(next.event, tz))].filter(Boolean).join(" · ")}</div>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[13px] tabular-nums">
                      <span><span className="mr-1.5 text-[10.5px] text-muted">HERE</span>{range(next.event)}</span>
                      {other && <span><span className="mr-1.5 text-[10.5px] text-muted">{short}</span>{range(next.event, other.timeZone)}</span>}
                    </div>
                    {next.event.meetingUrl && <a href={next.event.meetingUrl} target="_blank" rel="noreferrer" className="hud-btn hud-btn-solid mt-3 min-h-10"><Video size={14} />{joinLabel(next.event.meetingUrl)}</a>}
                  </div>
                </div>
              ) : (
                <Empty>No more timed meetings this week.</Empty>
              )}
            </Card>

            {other && (
              <Card title="Time-zone bridge" accent="lime" flush action={`${other.label} is ${off === 0 ? "on the same time" : `${Math.abs(off)} h ${off > 0 ? "ahead" : "behind"}`}`}>
                <div className="px-4 pb-4 pt-4 sm:px-5">
                  {[{ name: tz.split("/").pop()!.replace(/_/g, " "), zone: tz, work: band(WORK_FROM, WORK_TO), color: "#3fd0ff" }, { name: other.label, zone: other.timeZone, work: band(theirs.from, theirs.to), color: "#a98bff" }].map((row) => (
                    <div key={row.zone} className="mb-2.5 grid grid-cols-[76px_minmax(0,1fr)] items-center gap-3 sm:grid-cols-[96px_minmax(0,1fr)]">
                      <div className="leading-tight">
                        <div className="hud-label truncate text-[10.5px] text-muted">{row.name}</div>
                        <div className="font-mono text-[14px] tabular-nums">{new Date(nowMs).toLocaleTimeString("en-GB", { timeZone: row.zone, hour: "2-digit", minute: "2-digit" })}</div>
                      </div>
                      <div className="relative h-5 border border-line/60 bg-cyan/[0.04]">
                        {row.work.map((b, i) => <i key={i} className="absolute inset-y-0" style={{ left: `${(b.l / 24) * 100}%`, width: `${(b.w / 24) * 100}%`, background: `linear-gradient(90deg, color-mix(in srgb, ${row.color} 55%, transparent), color-mix(in srgb, ${row.color} 30%, transparent))` }} />)}
                        {hasOverlap && <i className="absolute -inset-y-1 border border-dashed border-lime/80" style={{ left: `${(overlap!.from / 24) * 100}%`, width: `${((overlap!.to - overlap!.from) / 24) * 100}%` }} />}
                        <i className="absolute -inset-y-1.5 w-0.5 bg-[#eaf7ff] shadow-[0_0_6px_#eaf7ff]" style={{ left: `${(nowH / 24) * 100}%` }} />
                      </div>
                    </div>
                  ))}
                  <div className="ml-[88px] flex justify-between font-mono text-[10.5px] text-muted sm:ml-[108px]"><span>0h</span><span>6</span><span>12</span><span>18</span><span>24</span></div>
                  <p className="mt-3 text-[12.5px] text-muted">
                    Shaded: 9 AM – 5 PM in each city, on the {tz.split("/").pop()!.replace(/_/g, " ")} clock.{" "}
                    {hasOverlap ? <>Both are at work <b className="font-medium text-lime">{hh(overlap!.from)} – {hh(overlap!.to)}</b> here ({hh((overlap!.from + off + 24) % 24)} – {hh((overlap!.to + off + 24) % 24)} {other.label}).</> : "Working hours don't overlap."}
                  </p>
                </div>
              </Card>
            )}
          </div>

          <div className="hud-panel no-scrollbar mb-4 grid grid-cols-7 overflow-x-auto lg:mb-[22px]" style={{ "--a": "#3fd0ff" } as CSSProperties}>
            {week.map((day) => {
              const ev = days.get(day) ?? [];
              const dt = new Date(`${day}T12:00:00Z`);
              return (
                <a key={day} href={ev.length ? `#day-${day}` : undefined} className={`min-w-[52px] border-r border-line/60 px-2 py-3 last:border-r-0 sm:px-4 ${day === now ? "bg-cyan/[0.07]" : ""}`}>
                  <div className={`hud-label text-[10.5px] ${day === now ? "text-cyan" : "text-muted"}`}>{dt.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short" })}</div>
                  <div className={`font-display text-[22px] font-semibold tabular-nums ${day === now ? "text-cyan" : ""}`}>{dt.getUTCDate()}</div>
                  <div className="mt-1.5 flex h-1 flex-wrap gap-[3px]">{ev.slice(0, 6).map((e) => <i key={e.id} className="block h-1 w-3 sm:w-4" style={{ background: calColor(e) }} />)}</div>
                  <div className="mt-1.5 hidden text-[11px] text-muted sm:block">{ev.length ? `${ev.length} event${ev.length === 1 ? "" : "s"}` : "Free"}</div>
                </a>
              );
            })}
          </div>

          <div className="grid items-start gap-4 lg:gap-[22px] xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="grid min-w-0 gap-4 lg:gap-[22px]">
              {sorted.map(([day, events]) => {
                const isToday = day === now;
                const firstAhead = events.findIndex((e) => !e.allDay && Date.parse(e.start) > nowMs);
                const nowAt = !isToday ? -1 : firstAhead === -1 ? events.length : firstAhead;
                const nowLine = (
                  <div className="flex items-center gap-2 px-4 sm:px-5" aria-label="Now">
                    <span className="bg-cyan px-1.5 font-mono text-[10.5px] font-bold text-bg">NOW {time(new Date(nowMs).toISOString())}</span>
                    <i className="h-px flex-1 bg-cyan shadow-[0_0_6px_#3fd0ff]" />
                  </div>
                );
                return (
                  <div key={day} id={`day-${day}`} className="scroll-mt-28">
                    <Card title={label(day)} accent="cyan" flush action={`${events.length} event${events.length === 1 ? "" : "s"}`}>
                      <ul>
                        {events.map((e, i) => {
                          const past = !e.allDay && Date.parse(e.end) <= nowMs;
                          return (
                            <li key={e.id}>
                              {i === nowAt && nowLine}
                              <div className={`grid grid-cols-[minmax(0,1fr)] gap-x-4 gap-y-1.5 border-b border-line/50 px-4 py-3 sm:grid-cols-[176px_minmax(0,1fr)_auto] sm:items-center sm:px-5 ${past ? "opacity-55" : ""}`}>
                                <div className="whitespace-nowrap font-mono text-[13px] tabular-nums">
                                  {e.allDay ? <span className="hud-label text-[12px] font-bold text-gold">All day</span> : range(e)}
                                  {!e.allDay && other && <div className="text-[11px] text-muted"><span className="mr-1 text-[10px] font-bold">{short}</span>{range(e, other.timeZone)}</div>}
                                </div>
                                <div className="min-w-0 border-l-2 pl-3" style={{ borderColor: calColor(e) }}>
                                  <div className="break-words text-[14px]">{e.url ? <a href={e.url} target="_blank" rel="noreferrer" className="hover:text-cyan">{e.title}</a> : e.title}</div>
                                  <div className="truncate text-[12px] text-muted">{[`${e.calendar} · ${e.provider === "google" ? "Google" : "Outlook"}`, e.location].filter(Boolean).join("   ")}{past ? " · done" : ""}</div>
                                </div>
                                {e.meetingUrl && !past && <a href={e.meetingUrl} target="_blank" rel="noreferrer" className="hud-btn min-h-10 justify-self-start sm:min-h-0 sm:justify-self-end"><Video size={13} />{joinLabel(e.meetingUrl)}</a>}
                              </div>
                            </li>
                          );
                        })}
                        {nowAt === events.length && <li className="py-2">{nowLine}</li>}
                      </ul>
                    </Card>
                  </div>
                );
              })}
            </div>

            <aside className="grid min-w-0 gap-4 lg:gap-[22px]">
              <Card title="Calendars" accent="violet" flush action={`${cals.length} with events`}>
                {cals.map((c) => (
                  <div key={`${c.provider}:${c.calendar}`} className="grid grid-cols-[10px_minmax(0,1fr)_auto] items-center gap-3 border-b border-line/50 px-4 py-2.5 last:border-0 sm:px-5">
                    <i className="h-2.5 w-2.5" style={{ background: calColor(c), boxShadow: `0 0 6px ${calColor(c)}` }} />
                    <div className="min-w-0">
                      <div className="truncate text-[13px]">{c.calendar}</div>
                      <div className="text-[11.5px] text-muted">{c.provider === "google" ? "Google" : "Outlook"}</div>
                    </div>
                    <span className="font-mono text-[12.5px] tabular-nums text-muted">{c.count}</span>
                  </div>
                ))}
              </Card>
              <Card title="This week" accent="gold" flush action={`${label(week[0]).replace("Today · ", "").split(", ").pop()} – ${new Date(`${week[6]}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" })}`}>
                <div className="px-4 py-2 sm:px-5">
                  <KV k="Events" v={stats.events} />
                  <KV k="Time in meetings" v={formatMinutes(stats.minutes)} />
                  <KV k="With a video link" v={stats.video} />
                  {other && <KV k={`Outside ${other.label} 9–5`} v={outside} />}
                  <KV k="Free days" v={week.filter((x) => !days.has(x)).length} />
                </div>
              </Card>
            </aside>
          </div>
        </>
      )}
    </>
  );
}
