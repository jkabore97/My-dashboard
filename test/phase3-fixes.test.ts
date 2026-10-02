import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, pgliteDb, useDb } from "@/lib/server/db";
import { fromGoogle, fromGraph, getCalendar, sortEvents } from "@/lib/connectors/calendar";
import { analyticsWithStore, ANALYTICS_KIND } from "@/lib/connectors/analytics";
import { msAccessToken } from "@/lib/server/microsoft";
import type { SiteAnalytics } from "@/lib/types";

beforeAll(async () => {
  await useDb(await pgliteDb());
});

beforeEach(async () => {
  const db = await getDb();
  await db.exec("truncate settings, snapshots, connections");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("calendar", () => {
  it("treats a 403 for a Google account with unknown scopes as not granted", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret");
    vi.stubEnv("GMAIL_ACCOUNTS", "Kaj:legacy-refresh-token"); // env accounts have unknown scopes
    vi.stubGlobal("fetch", async (url: string) =>
      url.startsWith("https://oauth2.googleapis.com/token") ? json({ access_token: "tok", expires_in: 3600 }) : json({ error: { message: "insufficient scopes" } }, 403),
    );
    const cal = await getCalendar();
    expect(cal).toMatchObject({ mode: "live", data: [] });
    expect(cal.partial).toBeUndefined();
  });

  it("sorts Google and Outlook events by real time", () => {
    const google = fromGoogle("Work", [
      { id: "g1", summary: "Google 09:00 New York", start: { dateTime: "2026-10-05T09:00:00-04:00" }, end: { dateTime: "2026-10-05T10:00:00-04:00" } },
      { id: "g2", summary: "All day", start: { date: "2026-10-05" }, end: { date: "2026-10-06" } },
    ]);
    expect(google[0]).toMatchObject({ start: "2026-10-05T13:00:00.000Z", end: "2026-10-05T14:00:00.000Z", allDay: false });
    expect(google[1]).toMatchObject({ start: "2026-10-05", allDay: true });
    const outlook = fromGraph("Mail", [{ id: "m1", subject: "Outlook 10:00Z", isAllDay: false, webLink: "u", start: { dateTime: "2026-10-05T10:00:00.0000000", timeZone: "UTC" }, end: { dateTime: "2026-10-05T11:00:00.0000000", timeZone: "UTC" } }]);
    expect(sortEvents([...google, ...outlook]).map((e) => e.title)).toEqual(["All day", "Outlook 10:00Z", "Google 09:00 New York"]);
  });
});

describe("Microsoft token refresh", () => {
  it("shares one refresh between parallel callers and clears it afterwards", async () => {
    vi.stubEnv("MS_CLIENT_ID", "id");
    vi.stubEnv("MS_CLIENT_SECRET", "secret");
    let calls = 0;
    let fail = true;
    vi.stubGlobal("fetch", async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 20));
      return fail ? json({ error: "temporarily_unavailable" }, 503) : json({ access_token: `at${calls}`, refresh_token: "rt", expires_in: 3600 });
    });
    const account = { account: "me@contoso.com", refreshToken: "rt" };
    const failed = await Promise.allSettled([msAccessToken(account), msAccessToken(account)]);
    expect(failed.every((r) => r.status === "rejected")).toBe(true);
    expect(calls).toBe(1);
    fail = false; // the failed refresh isn't reused: the next call tries again
    expect(await Promise.all([msAccessToken(account), msAccessToken(account), msAccessToken(account)])).toEqual(["at2", "at2", "at2"]);
    expect(calls).toBe(2);
  });
});

describe("analytics stored results", () => {
  const site = (domain: string, sessions: number): SiteAnalytics => ({ domain, property: "properties/1", traffic: { sessions: [], users: [], totals: { sessions, users: 0, newUsers: 0, keyEvents: 0 }, topPages: [] }, search: null });
  const refresher = (sites: SiteAnalytics[], complete = true) => {
    const fn = vi.fn(async () => ({ sites, complete }));
    return fn;
  };

  it("serves a fresh stored result without calling Google", async () => {
    const first = refresher([site("a.com", 10), site("b.com", 20)]);
    expect(await analyticsWithStore(["a.com", "b.com"], first)).toHaveLength(2);
    expect(first).toHaveBeenCalledTimes(1);
    const cold = refresher([site("a.com", 99), site("b.com", 99)]); // e.g. a new serverless instance
    const out = await analyticsWithStore(["a.com", "b.com"], cold);
    expect(cold).not.toHaveBeenCalled();
    expect(out.map((s) => s.traffic?.totals.sessions)).toEqual([10, 20]);
  });

  it("refreshes once it is older than 15 minutes, one request at a time", async () => {
    await analyticsWithStore(["a.com"], refresher([site("a.com", 10)]));
    const db = await getDb();
    await db.query("update snapshots set taken_at = now() - interval '20 minutes' where kind = $1", [ANALYTICS_KIND]);
    await db.query("update settings set updated_at = now() - interval '20 minutes' where key = 'job:analytics'");
    const slow = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 30));
      return { sites: [site("a.com", 11)], complete: true };
    });
    const [x, y] = await Promise.all([analyticsWithStore(["a.com"], slow), analyticsWithStore(["a.com"], slow)]);
    expect(slow).toHaveBeenCalledTimes(1); // the other request served the stored result
    expect([x[0].traffic?.totals.sessions, y[0].traffic?.totals.sessions].sort()).toEqual([10, 11]);
    expect((await analyticsWithStore(["a.com"], slow))[0].traffic?.totals.sessions).toBe(11);
    const [{ n }] = await db.query<{ n: number }>("select count(*)::int as n from snapshots where kind = $1", [ANALYTICS_KIND]);
    expect(n).toBe(1); // a cache, not history
  });

  it("fetches live for a site with no stored result, and keeps only sites with data after a partial failure", async () => {
    await analyticsWithStore(["a.com"], refresher([site("a.com", 10)]));
    const partial = refresher([site("a.com", 12), { domain: "new.com", property: null, traffic: null, search: null }], false);
    expect(await analyticsWithStore(["a.com", "new.com"], partial)).toHaveLength(2);
    expect(partial).toHaveBeenCalledTimes(1);
    const db = await getDb();
    const keys = await db.query<{ key: string }>("select key from snapshots where kind = $1 order by key", [ANALYTICS_KIND]);
    expect(keys.map((k) => k.key)).toEqual(["a.com"]);
  });

  it("lets the next request retry after a failed refresh", async () => {
    const broken = vi.fn(async () => {
      throw new Error("quota");
    });
    await expect(analyticsWithStore(["a.com"], broken)).rejects.toThrow("quota");
    await expect(analyticsWithStore(["a.com"], broken)).rejects.toThrow("quota");
    expect(broken).toHaveBeenCalledTimes(2);
  });
});
