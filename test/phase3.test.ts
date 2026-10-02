import { describe, expect, it } from "vitest";
import { deriveGrowthTasks, followUpSeverity, weeklyChange, type GrowthInput } from "@/lib/growth";
import { gaDate, matchSearchConsole, toSearch, toTraffic } from "@/lib/connectors/analytics";
import { toEmails } from "@/lib/connectors/outlook";
import { fromGoogle, fromGraph } from "@/lib/connectors/calendar";
import { parsePlaces, toPlaceReviews } from "@/lib/connectors/reviews";
import { eventDay, todaysEvents } from "@/lib/agenda";
import { hasGoogleScope, GOOGLE_SCOPES } from "@/lib/server/google";
import { deriveTasks, undecryptableGuards } from "@/lib/aggregate";
import type { Deal } from "@/lib/server/store/pipeline";
import type { CalendarEvent } from "@/lib/types";

const deal = (over: Partial<Deal> = {}): Deal => ({ id: "d1", clientId: null, clientName: "ClientCo", business: "Kaj", title: "Website redesign", valueMinor: 450000, currency: "usd", stage: "proposal", expectedClose: null, nextStep: null, nextStepDue: null, closedOn: null, notes: null, updatedOn: "2026-10-01", ...over });

const base = (): GrowthInput => ({
  today: "2026-10-02",
  deals: [],
  reviews: [],
  analytics: [],
  domains: [],
  businessForDomain: () => "Kaj",
  modes: { pipeline: "live", reviews: "live", analytics: "live" },
  partial: { reviews: [] },
});

describe("pipeline tasks", () => {
  it("raises due follow-ups, escalating after 3 days", () => {
    const g = base();
    g.deals = [
      deal({ id: "a", nextStep: "Send quote", nextStepDue: "2026-10-02" }),
      deal({ id: "b", nextStep: "Call back", nextStepDue: "2026-09-25" }),
      deal({ id: "c", nextStep: "Later", nextStepDue: "2026-10-09" }),
      deal({ id: "d", stage: "won", nextStep: "Kickoff", nextStepDue: "2026-09-01" }),
    ];
    const t = deriveGrowthTasks(g).tasks.filter((x) => x.id.includes(":next:"));
    expect(t.map((x) => [x.id, x.severity])).toEqual([["pipeline/a:next:2026-10-02", "medium"], ["pipeline/b:next:2026-09-25", "high"]]);
    expect(t[0].title).toBe("ClientCo: Send quote");
    expect(t[1].detail).toContain("$4,500.00 · 7 days overdue");
    expect([0, 3, 4].map(followUpSeverity)).toEqual(["medium", "medium", "high"]);
  });
  it("flags passed close dates and stalled proposals", () => {
    const g = base();
    g.deals = [
      deal({ id: "x", expectedClose: "2026-09-30", nextStep: "Wait", nextStepDue: "2026-10-20" }),
      deal({ id: "y", updatedOn: "2026-09-10" }),
      deal({ id: "z", stage: "lead", updatedOn: "2026-01-01" }), // leads don't stall
    ];
    const ids = deriveGrowthTasks(g).tasks.map((x) => x.id);
    expect(ids).toEqual(["pipeline/x:close:2026-09-30", "pipeline/y:stalled"]);
  });
});

describe("review tasks", () => {
  it("asks to reply to recent low reviews only", () => {
    const g = base();
    g.reviews = [{
      placeId: "p1", business: "Kaj", name: "Kaj Consulting", rating: 4.5, reviewCount: 10, url: "https://maps",
      reviews: [
        { id: "places/p1/reviews/aaa", rating: 2, text: "Late delivery", author: "J", publishedAt: "2026-09-28T10:00:00Z", relative: null },
        { id: "places/p1/reviews/bbb", rating: 5, text: "Great", author: "A", publishedAt: "2026-09-29T10:00:00Z", relative: null },
        { id: "places/p1/reviews/ccc", rating: 1, text: "Old", author: "B", publishedAt: "2026-07-01T10:00:00Z", relative: null },
      ],
    }];
    const t = deriveGrowthTasks(g).tasks;
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ severity: "high", title: "Reply to 2★ review of Kaj Consulting", url: "https://maps" });
    expect(t[0].id).toMatch(/^reviews\/p1\/[0-9a-f]{12}$/);
  });
  it("protects places that failed this round", () => {
    const g = base();
    g.partial.reviews = ["p9"];
    expect(deriveGrowthTasks(g).unobserved).toContain("reviews/p9/");
  });
});

describe("traffic tasks", () => {
  const days = (a: number, b: number) => [...Array(7).fill(a), ...Array(7).fill(b)].map((value, i) => ({ date: `2026-09-${String(i + 10).padStart(2, "0")}`, value }));
  it("computes week-on-week change", () => {
    expect(weeklyChange(days(10, 5))).toEqual({ thisWeek: 35, lastWeek: 70, change: -0.5 });
    expect(weeklyChange(days(10, 5).slice(1))).toBeNull();
  });
  it("raises a drop of 40%+ from real traffic, and protects sites without data", () => {
    const g = base();
    const site = (domain: string, a: number, b: number) => ({ domain, property: "p", search: null, traffic: { sessions: days(a, b), users: [], totals: { sessions: 0, users: 0, newUsers: 0, keyEvents: 0 }, topPages: [] } });
    g.analytics = [site("big.com", 100, 50), site("tiny.com", 5, 1), site("ok.com", 100, 90)];
    g.domains = ["big.com", "tiny.com", "ok.com", "nodata.com"];
    const out = deriveGrowthTasks(g);
    expect(out.tasks.map((t) => t.id)).toEqual(["analytics/drop:big.com"]);
    expect(out.tasks[0].title).toBe("Traffic to big.com is down 50% this week");
    expect(out.unobserved).toEqual(["analytics/drop:nodata.com"]);
  });
});

describe("analytics parsing", () => {
  it("converts GA4 reports", () => {
    expect(gaDate("20260915")).toBe("2026-09-15");
    const t = toTraffic(
      { rows: [{ dimensionValues: [{ value: "20260916" }], metricValues: [{ value: "5" }, { value: "4" }, { value: "1" }, { value: "0" }] }, { dimensionValues: [{ value: "20260915" }], metricValues: [{ value: "7" }, { value: "6" }, { value: "2" }, { value: "1" }] }] },
      { rows: [{ metricValues: [{ value: "12" }, { value: "9" }, { value: "3" }, { value: "1" }] }] },
      { rows: [{ dimensionValues: [{ value: "/" }], metricValues: [{ value: "20" }] }] },
    );
    expect(t.sessions).toEqual([{ date: "2026-09-15", value: 7 }, { date: "2026-09-16", value: 5 }]);
    expect(t.totals).toEqual({ sessions: 12, users: 9, newUsers: 3, keyEvents: 1 });
    expect(t.topPages).toEqual([{ path: "/", views: 20 }]);
  });
  it("matches Search Console properties to sites", () => {
    const sites = ["https://www.shop.example/", "sc-domain:kaj.com", "https://other.io/"];
    expect(matchSearchConsole("portal.kaj.com", sites)).toBe("sc-domain:kaj.com");
    expect(matchSearchConsole("shop.example", sites)).toBe("https://www.shop.example/");
    expect(matchSearchConsole("nope.dev", sites)).toBeNull();
    const s = toSearch("sc-domain:kaj.com", { rows: [{ keys: ["2026-09-02"], clicks: 3, impressions: 40, ctr: 0.075, position: 8 }] }, { rows: [{ keys: [], clicks: 3, impressions: 40, ctr: 0.075, position: 8 }] }, {});
    expect(s.totals.clicks).toBe(3);
    expect(s.clicks).toEqual([{ date: "2026-09-02", value: 3 }]);
  });
});

describe("Outlook, calendar, reviews parsing", () => {
  it("maps Graph messages into the shared inbox shape", () => {
    const [m] = toEmails({ account: "me@kaj.com", label: "Kaj" }, [{ id: "AAA", subject: "Payment failed for invoice", bodyPreview: "Your card was declined", receivedDateTime: "2026-10-01T10:00:00Z", isRead: false, importance: "high", webLink: "https://outlook", from: { emailAddress: { name: "Billing", address: "billing@x.com" } } }]);
    expect(m).toMatchObject({ id: "ms:me@kaj.com:AAA", mailbox: "ms:me@kaj.com", account: "Kaj", unread: true, severity: "critical", labels: ["IMPORTANT"] });
  });
  it("normalizes Google and Graph events", () => {
    const g = fromGoogle("Kaj", [{ id: "1", summary: "Call", start: { dateTime: "2026-10-02T10:00:00+02:00" }, end: { dateTime: "2026-10-02T11:00:00+02:00" }, hangoutLink: "https://meet" }, { id: "2", status: "cancelled", start: { date: "2026-10-03" }, end: { date: "2026-10-04" } }]);
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ allDay: false, meetingUrl: "https://meet" });
    const m = fromGraph("Kaj", [{ id: "x", subject: "Review", isAllDay: false, webLink: "w", start: { dateTime: "2026-10-02T08:00:00.0000000", timeZone: "UTC" }, end: { dateTime: "2026-10-02T09:00:00.0000000", timeZone: "UTC" } }, { id: "y", subject: "Off", isAllDay: true, webLink: "w", start: { dateTime: "2026-10-05T00:00:00.0000000", timeZone: "UTC" }, end: { dateTime: "2026-10-06T00:00:00.0000000", timeZone: "UTC" } }]);
    expect(m[0].start).toBe("2026-10-02T08:00:00.000Z");
    expect(m[1]).toMatchObject({ allDay: true, start: "2026-10-05" });
  });
  it("puts events on the business-timezone day", () => {
    const e = (start: string, allDay = false): CalendarEvent => ({ id: start, title: "", start, end: allDay ? start : new Date(Date.parse(start) + 3_600_000).toISOString(), allDay, calendar: "", provider: "google", location: null, meetingUrl: null, url: null });
    expect(eventDay(e("2026-10-02T02:00:00Z"), "America/New_York")).toBe("2026-10-01");
    expect(eventDay(e("2026-10-02", true), "America/New_York")).toBe("2026-10-02");
    const now = new Date("2026-10-02T12:00:00Z");
    expect(todaysEvents([e("2026-10-02T09:00:00Z"), e("2026-10-02T15:00:00Z"), e("2026-10-03T09:00:00Z"), e("2026-10-02", true)], "UTC", now).map((x) => x.start)).toEqual(["2026-10-02T15:00:00Z", "2026-10-02"]);
  });
  it("parses Places responses and config", () => {
    expect(parsePlaces("ChIJabc123456 | Kaj\n\nChIJdef789012")).toEqual([{ placeId: "ChIJabc123456", business: "Kaj" }, { placeId: "ChIJdef789012", business: "Unassigned" }]);
    const p = toPlaceReviews({ placeId: "ChIJabc123456", business: "Kaj" }, { id: "x", displayName: { text: "Kaj Consulting" }, rating: 4.6, userRatingCount: 12, reviews: [{ name: "r/1", rating: 3, text: { text: "ok" }, publishTime: "2026-09-01T00:00:00Z" }, { name: "r/2", rating: 5, originalText: { text: "great" }, authorAttribution: { displayName: "Ama" }, publishTime: "2026-09-20T00:00:00Z" }] });
    expect(p).toMatchObject({ name: "Kaj Consulting", rating: 4.6, reviewCount: 12 });
    expect(p.reviews.map((r) => [r.id, r.author])).toEqual([["r/2", "Ama"], ["r/1", "A Google user"]]);
  });
});

describe("Google scopes and Outlook task scope", () => {
  it("knows what a Google account granted", () => {
    expect(hasGoogleScope(null, "calendar")).toBeNull();
    expect(hasGoogleScope([GOOGLE_SCOPES.gmail], "calendar")).toBe(false);
    expect(hasGoogleScope([GOOGLE_SCOPES.gmail, GOOGLE_SCOPES.calendar], "calendar")).toBe(true);
  });
  it("keys Outlook mail tasks under their own scope and protects broken Microsoft rows", () => {
    const tasks = deriveTasks({
      repos: [], hosting: [], databases: [], websites: [], sources: [],
      emails: [{ id: "ms:me@kaj.com:A", from: "x", subject: "Urgent: action required", snippet: "", receivedAt: "2026-10-01T00:00:00Z", unread: true, account: "Kaj", mailbox: "ms:me@kaj.com", labels: [], severity: "high" }],
      modes: { github: "demo", vercel: "demo", workers: "demo", supabase: "demo", d1: "demo", gmail: "demo", websites: "demo", outlook: "live" },
    });
    expect(tasks[0]).toMatchObject({ scope: "outlook", live: true, id: "outlook/ms%3Ame%40kaj.com/ms:me@kaj.com:A" });
    expect(undecryptableGuards([{ provider: "microsoft", account: "me@kaj.com" }]).unobserved).toEqual(["outlook/ms%3Ame%40kaj.com/"]);
  });
});
