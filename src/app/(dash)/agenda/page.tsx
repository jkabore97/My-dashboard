import { Video } from "lucide-react";
import { getDashboard } from "@/lib/server/dashboard";
import { businessTimeZone, today } from "@/lib/dates";
import { Card, Empty, PageHeader } from "@/components/ui";
import type { CalendarEvent } from "@/lib/types";
import { eventDay } from "@/lib/agenda";

export default async function AgendaPage() {
  const d = await getDashboard();
  const tz = businessTimeZone();
  const now = today(tz);
  const time = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
  const days = new Map<string, CalendarEvent[]>();
  for (const e of d.calendar) {
    const day = eventDay(e, tz);
    if (day < now) continue;
    days.set(day, [...(days.get(day) ?? []), e]);
  }
  const label = (day: string) => {
    const s = new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long", month: "short", day: "numeric" });
    return day === now ? `Today · ${s}` : s;
  };

  return (
    <>
      <PageHeader mode={d.modes.calendar} title="Agenda" subtitle={`The next 7 days from every connected Google and Outlook calendar. Times in ${tz}.`} />
      {days.size === 0 ? <Card><Empty>Nothing scheduled. Connect Google or Microsoft 365 on the Platforms page to see your meetings.</Empty></Card> : (
        <div className="grid gap-4">
          {[...days].sort(([a], [b]) => a.localeCompare(b)).map(([day, events]) => (
            <Card key={day} title={label(day)} action={<span className="text-xs text-muted">{events.length} event{events.length === 1 ? "" : "s"}</span>}>
              <ul className="-my-2 divide-y divide-line">
                {events.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-start gap-x-4 gap-y-1 py-2.5">
                    <span className="w-28 shrink-0 text-sm tabular-nums text-muted">{e.allDay ? "All day" : `${time(e.start)}–${time(e.end)}`}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm">{e.url ? <a href={e.url} target="_blank" rel="noreferrer" className="hover:text-accent">{e.title}</a> : e.title}</div>
                      <div className="text-xs text-muted">{[e.calendar, e.provider === "google" ? "Google" : "Outlook", e.location].filter(Boolean).join(" · ")}</div>
                    </div>
                    {e.meetingUrl && <a href={e.meetingUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs text-accent hover:border-accent/50"><Video size={12} />Join</a>}
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
