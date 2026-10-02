import { describe, expect, it } from "vitest";
import { businessRing, calendarSummary, eventVolume, formatMinutes, groupByDay, inboxStats, meetingStats, nextEvent, severityCounts, sourceCounts, sourceName, topLines, uptimeBuckets, worstSeverity } from "@/components/command/logic";
import type { CalendarEvent, EmailMessage } from "@/lib/types";

const email = (o: Partial<EmailMessage>): EmailMessage => ({ id: "1", from: "a", subject: "s", snippet: "", receivedAt: "2026-10-02T10:00:00Z", unread: false, account: "Kaj", mailbox: "kaj@x.com", labels: [], severity: "low", ...o });
const ev = (o: Partial<CalendarEvent>): CalendarEvent => ({ id: "e", title: "t", start: "2026-10-02T14:00:00Z", end: "2026-10-02T15:00:00Z", allDay: false, calendar: "Work", provider: "google", location: null, meetingUrl: null, url: null, ...o });

describe("command roll-ups", () => {
  it("colors each business by its worst open task", () => {
    expect(worstSeverity([])).toBeNull();
    expect(worstSeverity([{ severity: "low" }, { severity: "high" }, { severity: "medium" }])).toBe("high");
    const ring = businessRing(["A", "B", "Unassigned"], [
      { business: "A", severity: "medium" },
      { business: "A", severity: "critical" },
      { severity: "high" },
    ]);
    expect(ring).toEqual([
      { business: "A", open: 2, critical: 1, high: 0, worst: "critical" },
      { business: "B", open: 0, critical: 0, high: 0, worst: null },
      { business: "Unassigned", open: 1, critical: 0, high: 1, worst: "high" },
    ]);
    expect(severityCounts([{ severity: "low" }, { severity: "low" }])).toEqual({ critical: 0, high: 0, medium: 0, low: 2 });
  });

  it("buckets uptime checks, worst status wins, and ignores old checks", () => {
    const now = Date.parse("2026-10-02T12:00:00Z");
    const at = (h: number) => new Date(now - h * 3_600_000).toISOString();
    const { ticks, pct } = uptimeBuckets([
      { status: "up", responseMs: 100, takenAt: at(30) },
      { status: "up", responseMs: 100, takenAt: at(1) },
      { status: "down", responseMs: null, takenAt: at(0.9) },
      { status: "up", responseMs: 100, takenAt: at(0.1) },
    ], now, 24, 24);
    expect(ticks).toHaveLength(24);
    expect(ticks[23]).toBe("down");
    expect(ticks[0]).toBeNull();
    expect(pct).toBeCloseTo((2 / 3) * 100);
    expect(uptimeBuckets([], now).pct).toBeNull();
  });

  it("summarizes the inbox per mailbox and by Claude's triage", () => {
    const s = inboxStats([
      email({ id: "1", unread: true, severity: "critical", triage: { severity: "critical", summary: "", needsReply: true, task: "x" } }),
      email({ id: "2", triage: { severity: "low", summary: "", needsReply: false, task: "pay" } }),
      email({ id: "3", triage: { severity: "low", summary: "", needsReply: false, task: null } }),
      email({ id: "4", account: "Store", mailbox: "ms:store", unread: true }),
    ]);
    expect(s).toMatchObject({ total: 4, unread: 2, critical: 1, criticalUnread: 1, triaged: 3, needsReply: 1, withTask: 1, fyi: 1 });
    expect(s.mailboxes.map((m) => [m.account, m.provider, m.total, m.unread])).toEqual([
      ["Kaj", "gmail", 3, 1],
      ["Store", "outlook", 1, 1],
    ]);
  });

  it("counts events per day and per source", () => {
    const now = new Date("2026-10-02T12:00:00Z");
    const vol = eventVolume([
      { at: "2026-10-02T09:00:00Z", severity: "critical" },
      { at: "2026-10-02T08:00:00Z", severity: "low" },
      { at: "2026-10-01T09:00:00Z", severity: "high" },
      { at: "2026-09-01T09:00:00Z", severity: "high" },
    ], 3, "UTC", now);
    expect(vol.map((d) => d.day)).toEqual(["2026-09-30", "2026-10-01", "2026-10-02"]);
    expect(vol[2]).toMatchObject({ critical: 1, low: 1 });
    expect(vol[1].high).toBe(1);
    expect(sourceName("Email · Kaj")).toBe("Email");
    expect(sourceCounts([{ at: "2026-10-02T09:00:00Z", source: "Email · A" }, { at: "2026-10-02T09:00:00Z", source: "Email · B" }, { at: "2026-10-02T09:00:00Z", source: "Vercel" }, { at: "2020-01-01T00:00:00Z", source: "Stripe" }], Date.parse("2026-10-01T00:00:00Z"))).toEqual([
      { source: "Email", count: 2 },
      { source: "Vercel", count: 1 },
    ]);
    const g = groupByDay([{ at: "2026-10-01T09:00:00Z" }, { at: "2026-10-02T09:00:00Z" }, { at: "2026-10-02T03:00:00Z" }], "UTC");
    expect(g.map(([d, l]) => [d, l.length])).toEqual([["2026-10-02", 2], ["2026-10-01", 1]]);
  });

  it("works out meetings, the next one and calendars", () => {
    const list = [
      ev({ id: "a", start: "2026-10-02T09:00:00Z", end: "2026-10-02T09:30:00Z" }),
      ev({ id: "b", start: "2026-10-02T14:00:00Z", end: "2026-10-02T15:15:00Z", meetingUrl: "https://meet.google.com/x", calendar: "Team" }),
      ev({ id: "c", allDay: true, start: "2026-10-03", end: "2026-10-04" }),
    ];
    expect(meetingStats(list)).toEqual({ events: 3, minutes: 105, video: 1 });
    expect(formatMinutes(105)).toBe("1 h 45 m");
    expect(formatMinutes(45)).toBe("45 m");
    expect(nextEvent(list, Date.parse("2026-10-02T10:00:00Z"))?.event.id).toBe("b");
    expect(nextEvent(list, Date.parse("2026-10-02T14:30:00Z"))).toMatchObject({ inProgress: true });
    expect(nextEvent(list, Date.parse("2026-10-02T16:00:00Z"))).toBeNull();
    expect(calendarSummary(list)).toEqual([{ calendar: "Work", provider: "google", count: 2 }, { calendar: "Team", provider: "google", count: 1 }]);
  });

  it("keeps the biggest spend lines and folds the rest", () => {
    expect(topLines([{ amount: 5 }, { amount: 30 }, { amount: 10 }, { amount: 1 }], 2)).toEqual({ top: [{ amount: 30 }, { amount: 10 }], rest: 2, restAmount: 6 });
  });
});
