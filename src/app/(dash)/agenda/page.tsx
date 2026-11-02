import Link from "next/link";
import { requireSection } from "@/lib/server/auth";
import { Video } from "lucide-react";
import { getDashboard } from "@/lib/server/dashboard";
import { addDays, businessTimeZone, today } from "@/lib/dates";
import { clockZones } from "@/lib/server/clocks";
import { Card, Empty, Group, PageHeader, Row, SYS, btn, businessColor, tint } from "@/components/ui";
import type { CalendarEvent } from "@/lib/types";
import { eventDay } from "@/lib/agenda";
import { Countdown } from "@/components/command/Countdown";
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

  const joinCls = "inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full bg-cyan px-3.5 text-[13px] font-semibold text-white transition hover:brightness-110 active:opacity-80 sm:min-h-8";
  const dayTitle = (day: string) => {
    const dt = new Date(`${day}T12:00:00Z`);
    const near = day === now || day === addDays(now, 1);
    const word = day === now ? "Today" : day === addDays(now, 1) ? "Tomorrow" : dt.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long" });
    return { word, date: dt.toLocaleDateString("en-US", { timeZone: "UTC", ...(near ? { weekday: "long" as const } : {}), month: "long", day: "numeric" }) };
  };
  const ring = "shadow-[0_0_0_1px_var(--color-line)]";

  return (
    <>
      <PageHeader mode={d.modes.calendar} title="Calendar" subtitle={`The next 7 days from the shared Google and Outlook calendars${d.calendar.some((e) => e.owner) ? " and your own (private to you)" : ""}. Times in ${tz}${other ? `, with ${other.label} alongside` : ""}.`}>
        <Link href="/settings#my-mail" className={btn("plain")}>My calendar</Link>
      </PageHeader>

      {sorted.length === 0 ? (
        <Group><Empty>No meetings this week. Connect your own Microsoft 365 or Google calendar in Settings → My mail &amp; calendar to see yours.</Empty></Group>
      ) : (
        <>
          <div className={`mb-7 grid gap-4 sm:gap-5 ${other ? "xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]" : ""}`}>
            <Card title={next?.inProgress ? "Happening now" : "Next up"} flush action={next ? `${next.event.calendar} · ${next.event.provider === "google" ? "Google" : "Outlook"}` : undefined}>
              {next ? (
                <div className="flex items-center gap-4 px-4 py-4 sm:gap-5 sm:px-5 sm:py-5">
                  <div className="w-[84px] shrink-0 sm:w-[110px]"><Countdown to={next.event.start} until={next.event.end} /></div>
                  <div className="min-w-0 flex-1 border-l-[3px] pl-3.5" style={{ borderColor: calColor(next.event) }}>
                    <div className="break-words text-[17px] font-semibold leading-snug text-ink">{next.event.url ? <a href={next.event.url} target="_blank" rel="noreferrer" className="hover:text-cyan">{next.event.title}</a> : next.event.title}</div>
                    <div className="mt-0.5 truncate text-[13px] text-muted">{[next.event.location, label(eventDay(next.event, tz))].filter(Boolean).join(" · ")}</div>
                    <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[15px] tabular-nums text-ink">
                      <span>{range(next.event)}</span>
                      {other && <span className="text-muted">{range(next.event, other.timeZone)} {other.label}</span>}
                    </div>
                    {next.event.meetingUrl && <a href={next.event.meetingUrl} target="_blank" rel="noreferrer" className={`${joinCls} mt-3`}><Video size={15} />{joinLabel(next.event.meetingUrl)}</a>}
                  </div>
                </div>
              ) : (
                <Empty>No more timed meetings this week.</Empty>
              )}
            </Card>

            {other && (
              <Card title="Time-zone bridge" flush action={`${other.label} is ${off === 0 ? "on the same time" : `${Math.abs(off)} h ${off > 0 ? "ahead" : "behind"}`}`}>
                <div className="px-4 pb-4 pt-4 sm:px-5">
                  {[{ name: tz.split("/").pop()!.replace(/_/g, " "), zone: tz, work: band(WORK_FROM, WORK_TO), color: SYS.blue }, { name: other.label, zone: other.timeZone, work: band(theirs.from, theirs.to), color: SYS.indigo }].map((row) => (
                    <div key={row.zone} className="mb-3 grid grid-cols-[76px_minmax(0,1fr)] items-center gap-3 sm:grid-cols-[96px_minmax(0,1fr)]">
                      <div className="leading-tight">
                        <div className="truncate text-[13px] text-muted">{row.name}</div>
                        <div className="text-[17px] font-semibold tabular-nums text-ink">{new Date(nowMs).toLocaleTimeString("en-GB", { timeZone: row.zone, hour: "2-digit", minute: "2-digit" })}</div>
                      </div>
                      <div className="relative h-6 rounded-[7px] bg-fill">
                        {row.work.map((b, i) => <i key={i} className="absolute inset-y-0 rounded-[7px]" style={{ left: `${(b.l / 24) * 100}%`, width: `${(b.w / 24) * 100}%`, background: tint(row.color, 45) }} />)}
                        {hasOverlap && <i className="absolute -inset-y-1 rounded-[9px] border-2 border-lime" style={{ left: `${(overlap!.from / 24) * 100}%`, width: `${((overlap!.to - overlap!.from) / 24) * 100}%` }} />}
                        <i className="absolute -inset-y-1.5 w-0.5 -translate-x-1/2 rounded-full bg-ink" style={{ left: `${(nowH / 24) * 100}%` }} />
                      </div>
                    </div>
                  ))}
                  <div className="ml-[88px] flex justify-between text-[12px] tabular-nums text-muted sm:ml-[108px]"><span>0h</span><span>6</span><span>12</span><span>18</span><span>24</span></div>
                  <p className="mt-3 text-[13px] leading-snug text-muted">
                    Shaded: 9 AM – 5 PM in each city, on the {tz.split("/").pop()!.replace(/_/g, " ")} clock.{" "}
                    {hasOverlap ? <>Both are at work <b className="font-semibold text-ok">{hh(overlap!.from)} – {hh(overlap!.to)}</b> here ({hh((overlap!.from + off + 24) % 24)} – {hh((overlap!.to + off + 24) % 24)} {other.label}).</> : "Working hours don't overlap."}
                  </p>
                </div>
              </Card>
            )}
          </div>

          <div className={`mb-7 grid grid-cols-7 overflow-hidden rounded-[14px] bg-panel ${ring}`}>
            {week.map((day) => {
              const ev = days.get(day) ?? [];
              const dt = new Date(`${day}T12:00:00Z`);
              const isToday = day === now;
              return (
                <a key={day} href={ev.length ? `#day-${day}` : undefined} className={`flex min-w-0 flex-col items-center px-1 py-2.5 sm:py-3 ${ev.length ? "transition-colors hover:bg-fill" : ""}`}>
                  <div className={`text-[12px] font-medium ${isToday ? "text-cyan" : "text-muted"}`}>{dt.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short" })}</div>
                  <div className={`mt-1 grid h-9 w-9 place-items-center rounded-full text-[19px] font-semibold tabular-nums ${isToday ? "bg-cyan text-white" : "text-ink"}`}>{dt.getUTCDate()}</div>
                  <div className="mt-1.5 flex h-1.5 max-w-full flex-wrap justify-center gap-[3px] overflow-hidden">{ev.slice(0, 4).map((e) => <i key={e.id} className="block h-1.5 w-1.5 rounded-full" style={{ background: calColor(e) }} />)}</div>
                  <div className="mt-1 hidden text-[12px] text-muted sm:block">{ev.length ? `${ev.length} event${ev.length === 1 ? "" : "s"}` : "Free"}</div>
                </a>
              );
            })}
          </div>

          <div className="grid items-start gap-7 xl:grid-cols-[minmax(0,1fr)_320px] xl:gap-8">
            <div className="grid min-w-0 gap-7">
              {sorted.map(([day, events]) => {
                const isToday = day === now;
                const firstAhead = events.findIndex((e) => !e.allDay && Date.parse(e.start) > nowMs);
                const nowAt = !isToday ? -1 : firstAhead === -1 ? events.length : firstAhead;
                const t = dayTitle(day);
                const nowLine = (
                  <div className="flex items-center gap-2 py-1 pl-2 pr-4 sm:pl-3" aria-label="Now">
                    <span className="w-[62px] shrink-0 text-right text-[12px] font-semibold tabular-nums text-cyan sm:w-[78px]">{time(new Date(nowMs).toISOString())}</span>
                    <i className="h-2 w-2 shrink-0 rounded-full bg-cyan" />
                    <i className="h-[1.5px] flex-1 rounded-full bg-cyan" />
                  </div>
                );
                return (
                  <section key={day} id={`day-${day}`} className="min-w-0 scroll-mt-28">
                    <div className="mb-2 flex items-baseline justify-between gap-3 px-1">
                      <h2 className="min-w-0 truncate text-[20px] font-bold tracking-[-0.01em] text-ink">
                        <span className={isToday ? "text-cyan" : undefined}>{t.word}</span> <span className="text-[15px] font-normal tracking-normal text-muted">{t.date}</span>
                      </h2>
                      <span className="shrink-0 text-[13px] text-muted">{events.length} event{events.length === 1 ? "" : "s"}</span>
                    </div>
                    <ul className={`overflow-hidden rounded-[14px] bg-panel ${ring}`}>
                      {events.map((e, i) => {
                        const past = !e.allDay && Date.parse(e.end) <= nowMs;
                        return (
                          <li key={e.id} className={i > 0 && i !== nowAt ? "border-t border-line" : ""}>
                            {i === nowAt && nowLine}
                            <div className={`flex items-start gap-3 py-3 pl-2 pr-4 sm:pl-3 sm:pr-5 ${past ? "opacity-50" : ""}`}>
                              <div className="w-[62px] shrink-0 text-right text-[13px] leading-snug tabular-nums sm:w-[78px]">
                                {e.allDay ? <span className="font-semibold text-ink">All day</span> : (
                                  <>
                                    <div className="font-semibold text-ink">{time(e.start)}</div>
                                    <div className="text-muted">{time(e.end)}</div>
                                  </>
                                )}
                              </div>
                              <i className="block w-[3px] shrink-0 self-stretch rounded-full" style={{ background: calColor(e) }} aria-hidden />
                              <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-3 gap-y-2">
                                <div className="min-w-0">
                                  <div className="break-words text-[15px] font-medium leading-snug text-ink">{e.url ? <a href={e.url} target="_blank" rel="noreferrer" className="hover:text-cyan">{e.title}</a> : e.title}</div>
                                  <div className="break-words text-[13px] leading-snug text-muted">{[`${e.calendar} · ${e.provider === "google" ? "Google" : "Outlook"}`, e.location].filter(Boolean).join(" · ")}{past ? " · done" : ""}</div>
                                  {!e.allDay && other && <div className="text-[13px] tabular-nums text-muted">{range(e, other.timeZone)} {other.label}</div>}
                                </div>
                                {e.meetingUrl && !past && <a href={e.meetingUrl} target="_blank" rel="noreferrer" className={joinCls}><Video size={14} />{joinLabel(e.meetingUrl)}</a>}
                              </div>
                            </div>
                          </li>
                        );
                      })}
                      {nowAt === events.length && <li className="border-t border-line py-1">{nowLine}</li>}
                    </ul>
                  </section>
                );
              })}
            </div>

            <aside className="grid min-w-0 gap-7">
              <Group header="Calendars" footer={`${cals.length} with events this week`}>
                {cals.map((c) => (
                  <Row key={`${c.provider}:${c.calendar}`} icon={<span className="h-2.5 w-2.5 rounded-full bg-white" />} iconColor={calColor(c)} label={c.calendar} sub={c.provider === "google" ? "Google" : "Outlook"} value={<span className="tabular-nums">{c.count}</span>} />
                ))}
              </Group>
              <Group header={`This week · ${label(week[0]).replace("Today · ", "").split(", ").pop()} – ${new Date(`${week[6]}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" })}`}>
                <Row label="Events" value={<span className="tabular-nums">{stats.events}</span>} />
                <Row label="Time in meetings" value={formatMinutes(stats.minutes)} />
                <Row label="With a video link" value={<span className="tabular-nums">{stats.video}</span>} />
                {other && <Row label={`Outside ${other.label} 9–5`} value={<span className="tabular-nums">{outside}</span>} />}
                <Row label="Free days" value={<span className="tabular-nums">{week.filter((x) => !days.has(x)).length}</span>} />
              </Group>
            </aside>
          </div>
        </>
      )}
    </>
  );
}
