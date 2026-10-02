import { demoCalendar } from "../demo";
import { googleAccounts, microsoftAccounts } from "../server/credentials";
import { googleAccessToken, googleApi, hasGoogleScope } from "../server/google";
import { graph, msAccessToken } from "../server/microsoft";
import { errorMessage, fromSource } from "../source";
import type { CalendarEvent } from "../types";

const DAYS_AHEAD = 7;

interface GoogleEvent {
  id: string;
  status?: string;
  summary?: string;
  htmlLink?: string;
  location?: string;
  hangoutLink?: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
}

interface GraphEvent {
  id: string;
  subject: string | null;
  isAllDay: boolean;
  isCancelled?: boolean;
  webLink: string;
  location?: { displayName?: string };
  onlineMeeting?: { joinUrl?: string } | null;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
}

export function fromGoogle(calendar: string, items: GoogleEvent[]): CalendarEvent[] {
  return items
    .filter((e) => e.status !== "cancelled")
    .map((e) => ({
      id: `google:${calendar}:${e.id}`,
      title: e.summary || "(no title)",
      start: e.start.dateTime ?? e.start.date!,
      end: e.end.dateTime ?? e.end.date!,
      allDay: !e.start.dateTime,
      calendar,
      provider: "google" as const,
      location: e.location ?? null,
      meetingUrl: e.hangoutLink ?? null,
      url: e.htmlLink ?? null,
    }));
}

/** Graph returns UTC wall-clock times (we ask for UTC) without a zone suffix. */
export function fromGraph(calendar: string, items: GraphEvent[]): CalendarEvent[] {
  const utc = (s: string) => (/[zZ]|[+-]\d\d:\d\d$/.test(s) ? s : `${s.replace(/\.\d+$/, "")}Z`);
  return items
    .filter((e) => !e.isCancelled)
    .map((e) => ({
      id: `microsoft:${calendar}:${e.id}`,
      title: e.subject || "(no title)",
      start: e.isAllDay ? e.start.dateTime.slice(0, 10) : new Date(utc(e.start.dateTime)).toISOString(),
      end: e.isAllDay ? e.end.dateTime.slice(0, 10) : new Date(utc(e.end.dateTime)).toISOString(),
      allDay: e.isAllDay,
      calendar,
      provider: "microsoft" as const,
      location: e.location?.displayName || null,
      meetingUrl: e.onlineMeeting?.joinUrl ?? null,
      url: e.webLink,
    }));
}

/** Today and the next 7 days from every connected Google and Microsoft calendar. */
export async function getCalendar() {
  const [google, microsoft] = await Promise.all([googleAccounts(), microsoftAccounts()]);
  const googleCal = google.filter((a) => hasGoogleScope(a.scopes, "calendar") !== false);
  return fromSource<CalendarEvent[]>(
    "Calendar",
    googleCal.length + microsoft.length > 0,
    async (fail) => {
      const from = new Date();
      from.setUTCHours(0, 0, 0, 0);
      from.setUTCDate(from.getUTCDate() - 1); // covers "today" in any timezone
      const to = new Date(Date.now() + (DAYS_AHEAD + 1) * 86_400_000);
      const jobs = [
        ...googleCal.map((a) => ({
          key: `google:${a.id}`,
          label: a.label,
          run: async () => {
            const token = await googleAccessToken(a.refreshToken);
            const q = new URLSearchParams({ timeMin: from.toISOString(), timeMax: to.toISOString(), singleEvents: "true", orderBy: "startTime", maxResults: "100" });
            const res = await googleApi<{ items?: GoogleEvent[] }>(token, `https://www.googleapis.com/calendar/v3/calendars/primary/events?${q}`);
            return fromGoogle(a.label, res.items ?? []);
          },
        })),
        ...microsoft.map((a) => ({
          key: `microsoft:${a.account}`,
          label: a.label,
          run: async () => {
            const token = await msAccessToken(a);
            const q = new URLSearchParams({ startDateTime: from.toISOString(), endDateTime: to.toISOString(), $top: "100", $orderby: "start/dateTime", $select: "id,subject,isAllDay,isCancelled,webLink,location,onlineMeeting,start,end" });
            const res = await graph<{ value: GraphEvent[] }>(token, `/me/calendarView?${q}`, { Prefer: 'outlook.timezone="UTC"' });
            return fromGraph(a.label, res.value);
          },
        })),
      ];
      const settled = await Promise.allSettled(jobs.map((j) => j.run()));
      settled.forEach((r, i) => r.status === "rejected" && fail(jobs[i].key, `${jobs[i].label}: ${errorMessage(r.reason)}`));
      const ok = settled.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
      if (ok.length === 0 && settled.every((r) => r.status === "rejected")) throw (settled[0] as PromiseRejectedResult).reason;
      return ok.sort((a, b) => a.start.localeCompare(b.start));
    },
    demoCalendar,
  );
}
