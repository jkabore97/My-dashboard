import { today } from "./dates";
import type { CalendarEvent } from "./types";

/** The calendar day an event falls on, in the business timezone. */
export function eventDay(e: CalendarEvent, tz: string) {
  return e.allDay ? e.start.slice(0, 10) : today(tz, new Date(e.start));
}

/** Events still to come today (or all-day today), in the business timezone. */
export function todaysEvents(events: CalendarEvent[], tz: string, now = new Date()) {
  const day = today(tz, now);
  return events.filter((e) => eventDay(e, tz) === day && (e.allDay || Date.parse(e.end) > now.getTime()));
}
