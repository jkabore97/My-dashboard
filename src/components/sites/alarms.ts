import type { Notification } from "@/lib/types";

// Pure helpers for the camera alarm list: stored events from the NVR's alarm
// server (source "Cameras"), newest first.

export interface CameraAlarm {
  id: string;
  title: string;
  body?: string;
  severity: Notification["severity"];
  at: string;
  /** "19:48" for today (in the given time zone), "Sep 30" otherwise. */
  when: string;
}

export function cameraAlarms(events: Notification[], timeZone: string, now = new Date(), days = 7, limit = 12): CameraAlarm[] {
  const since = now.getTime() - days * 86_400_000;
  const dayOf = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const today = dayOf(now);
  return events
    .filter((e) => e.source === "Cameras" && Date.parse(e.at) > since && Date.parse(e.at) <= now.getTime() + 60_000)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, limit)
    .map((e) => {
      const at = new Date(e.at);
      const when = dayOf(at) === today
        ? new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at)
        : new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric" }).format(at);
      return { id: e.id, title: e.title, ...(e.body ? { body: e.body } : {}), severity: e.severity, at: e.at, when };
    });
}

/** Disk usage as a percentage, when the recorder reports both sizes. */
export function diskUsedPct(capacityMB: number | null, freeMB: number | null): number | null {
  if (capacityMB === null || freeMB === null || capacityMB <= 0 || freeMB < 0 || freeMB > capacityMB) return null;
  return Math.round(((capacityMB - freeMB) / capacityMB) * 100);
}

export const diskSize = (mb: number | null) => (mb === null ? null : mb >= 1_000_000 ? `${(mb / 1_048_576).toFixed(1)} TB` : `${Math.round(mb / 1024)} GB`);
