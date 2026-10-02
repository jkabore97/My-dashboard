import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, pgliteDb, useDb } from "@/lib/server/db";
import { digestFetch, digestHeader, parseChallenge } from "@/lib/server/digest";
import { parseChannels, parseDeviceInfo, parseEventAlert, parseStorage, parseVideoInputs, type CameraSiteStatus } from "@/lib/connectors/hikvision";
import { validateSiteUrl } from "@/lib/server/site-credentials";
import { handleHikvision } from "@/lib/server/webhook-handlers";
import { buildStations, DEFAULT_SOLAR_SETTINGS, deriveSolarTasks, parseReading, type SolarReading } from "@/lib/solar";
import { deriveDeviceTasks } from "@/lib/devices";
import { fixForTask } from "@/lib/fix-match";
import { buildWeeklyReport, renderBrief, revenueOn } from "@/lib/brief";
import { validSubscription } from "@/lib/server/notify";
import { checkIngestToken, loadReadings, storeReading } from "@/lib/server/solar-store";
import { cachedTriage, triagePending, withTriage } from "@/lib/server/triage";
import { setSetting } from "@/lib/server/store/settings";
import { sha256Hex } from "@/lib/server/crypto";
import type { EmailMessage, StripeAccountSummary } from "@/lib/types";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

// ─── Digest auth ─────────────────────────────────────────────────────────────

describe("digest auth", () => {
  it("computes the RFC 2617 example response", () => {
    const challenge = parseChallenge('Digest realm="testrealm@host.com", qop="auth,auth-int", nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093", opaque="5ccc069c403ebaf9f0171e9517f40e41"');
    expect(challenge).toMatchObject({ realm: "testrealm@host.com", qop: "auth,auth-int", nonce: "dcd98b7102dd2f0e8b11d0f600bfb0c093" });
    const h = digestHeader({ username: "Mufasa", password: "Circle Of Life", method: "GET", uri: "/dir/index.html", challenge, cnonce: "0a4f113b", nc: "00000001" });
    expect(h).toContain('response="6629fae49393a05397450978507c4ef1"');
    expect(h).toContain("qop=auth");
    expect(h).toContain('opaque="5ccc069c403ebaf9f0171e9517f40e41"');
  });

  it("retries once with credentials after a 401 challenge", async () => {
    const calls: (string | null)[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      const auth = (init.headers as Record<string, string> | undefined)?.Authorization ?? null;
      calls.push(auth);
      return auth ? new Response("<ok/>", { status: 200 }) : new Response("", { status: 401, headers: { "WWW-Authenticate": 'Digest realm="DS", nonce="abc", qop="auth"' } });
    });
    const res = await digestFetch("https://nvr.example.com/ISAPI/System/deviceInfo", { username: "viewer", password: "pw" });
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatch(/^Digest username="viewer", realm="DS", nonce="abc", uri="\/ISAPI\/System\/deviceInfo"/);
  });
});

// ─── ISAPI parsers ───────────────────────────────────────────────────────────

const NS = 'xmlns="http://www.hikvision.com/ver20/XMLSchema" version="2.0"';

describe("Hikvision ISAPI parsing", () => {
  it("reads device info", () => {
    expect(parseDeviceInfo(`<?xml version="1.0"?><DeviceInfo ${NS}><deviceName>Office NVR</deviceName><model>DS-7608NI-K2</model><serialNumber>DS-7608NI-K20120230101</serialNumber><firmwareVersion>V4.61.010</firmwareVersion></DeviceInfo>`)).toEqual({
      name: "Office NVR",
      model: "DS-7608NI-K2",
      serial: "DS-7608NI-K20120230101",
      firmware: "V4.61.010",
    });
  });

  it("joins NVR channels with their online status, single or many", () => {
    const list = `<InputProxyChannelList ${NS}><InputProxyChannel><id>2</id><name>Parking</name></InputProxyChannel><InputProxyChannel><id>1</id><name>Front door</name></InputProxyChannel><InputProxyChannel><id>3</id><name></name></InputProxyChannel></InputProxyChannelList>`;
    const status = `<InputProxyChannelStatusList ${NS}><InputProxyChannelStatus><id>1</id><online>true</online></InputProxyChannelStatus><InputProxyChannelStatus><id>2</id><online>false</online></InputProxyChannelStatus></InputProxyChannelStatusList>`;
    expect(parseChannels(list, status)).toEqual([
      { id: 1, name: "Front door", online: true },
      { id: 2, name: "Parking", online: false },
      { id: 3, name: "Camera 3", online: null },
    ]);
    const one = `<InputProxyChannelList ${NS}><InputProxyChannel><id>1</id><name>Only</name></InputProxyChannel></InputProxyChannelList>`;
    expect(parseChannels(one, null)).toEqual([{ id: 1, name: "Only", online: null }]);
    expect(parseChannels(`<InputProxyChannelList ${NS}></InputProxyChannelList>`, null)).toEqual([]);
  });

  it("reads a standalone camera's video inputs", () => {
    expect(parseVideoInputs(`<VideoInputChannelList ${NS}><VideoInputChannel><id>1</id><name>Gate</name></VideoInputChannel></VideoInputChannelList>`)).toEqual([{ id: 1, name: "Gate", online: true }]);
  });

  it("reads disks", () => {
    const body = `<storage ${NS}><hddList><hdd><id>1</id><hddName>hdd1</hddName><status>ok</status><capacity>3815447</capacity><freeSpace>0</freeSpace></hdd><hdd><id>2</id><hddName>hdd2</hddName><status>Error</status><capacity>1907729</capacity><freeSpace>12</freeSpace></hdd></hddList></storage>`;
    expect(parseStorage(body)).toEqual([
      { id: "1", name: "hdd1", status: "ok", capacityMB: 3815447, freeMB: 0 },
      { id: "2", name: "hdd2", status: "error", capacityMB: 1907729, freeMB: 12 },
    ]);
  });

  it("reads an alarm event, also from inside a multipart body", () => {
    const xml = `<EventNotificationAlert ${NS}><ipAddress>192.168.1.64</ipAddress><channelID>4</channelID><dateTime>2026-10-02T09:15:00+02:00</dateTime><eventType>videoloss</eventType><eventState>active</eventState><eventDescription>videoloss alarm</eventDescription></EventNotificationAlert>`;
    expect(parseEventAlert(xml)).toEqual({ type: "videoloss", state: "active", channel: 4, at: "2026-10-02T07:15:00.000Z", description: "videoloss alarm" });
    const multipart = `--boundary\r\nContent-Disposition: form-data; name="alert"\r\nContent-Type: application/xml\r\n\r\n${xml}\r\n--boundary--`;
    const extracted = multipart.match(/<EventNotificationAlert[\s\S]*?<\/EventNotificationAlert>/)?.[0];
    expect(parseEventAlert(extracted!)?.type).toBe("videoloss");
    expect(parseEventAlert("<Other/>")).toBeNull();
  });
});

describe("tunnel address validation", () => {
  it("accepts a public https hostname and normalises it", () => {
    expect(validateSiteUrl("https://nvr.example.com/")).toEqual({ ok: true, url: "https://nvr.example.com" });
    expect(validateSiteUrl("https://cams.example.com:8443/base/")).toEqual({ ok: true, url: "https://cams.example.com:8443/base" });
  });
  it.each(["http://nvr.example.com", "https://192.168.1.64", "https://localhost", "https://10.0.0.5", "https://nvr.local", "https://[::1]", "https://user:pw@nvr.example.com", "not a url", "https://8.8.8.8"])("rejects %s", (u) => {
    expect(validateSiteUrl(u).ok).toBe(false);
  });
});

// ─── Camera alarms → tasks ───────────────────────────────────────────────────

describe("Hikvision alarm webhook handling", () => {
  const site = { id: "nvr.example.com", label: "Office", business: "Kaj Consulting" };
  const at = "2026-10-02T07:15:00.000Z";

  it("ignores the videoloss heartbeat", () => {
    const out = handleHikvision(site, { type: "videoloss", state: "inactive", channel: null, at, description: null });
    expect(out).toEqual({ events: [], openTasks: [], resolveTasks: [] });
  });

  it("opens a task on video loss and closes it when video returns", () => {
    const open = handleHikvision(site, { type: "videoloss", state: "active", channel: 4, at, description: "videoloss alarm" }, "Back gate");
    expect(open.openTasks).toEqual([expect.objectContaining({ key: "hikvision:nvr.example.com:videoloss:4", title: "Video loss: Back gate at Office", severity: "high", business: "Kaj Consulting" })]);
    expect(open.events).toHaveLength(1);
    const back = handleHikvision(site, { type: "videoloss", state: "inactive", channel: 4, at, description: "videoloss alarm" });
    expect(back.resolveTasks).toEqual(["hikvision:nvr.example.com:videoloss:4"]);
  });

  it("treats disk errors as critical and keeps failed logins open until done by hand", () => {
    expect(handleHikvision(site, { type: "hderror", state: "active", channel: null, at, description: null }).openTasks[0].severity).toBe("critical");
    expect(handleHikvision(site, { type: "illaccess", state: "inactive", channel: null, at, description: null }).resolveTasks).toEqual([]);
  });

  it("keeps motion as low history, one per channel per 10 minutes", () => {
    const a = handleHikvision(site, { type: "vmd", state: "active", channel: 1, at: "2026-10-02T07:10:05.000Z", description: null });
    const b = handleHikvision(site, { type: "vmd", state: "active", channel: 1, at: "2026-10-02T07:19:55.000Z", description: null });
    expect(a.openTasks).toEqual([]);
    expect(a.events[0]).toMatchObject({ severity: "low" });
    expect(a.events[0].dedupeKey).toBe(b.events[0].dedupeKey);
  });
});

// ─── Device rules ────────────────────────────────────────────────────────────

const camSite = (over: Partial<CameraSiteStatus> = {}): CameraSiteStatus => ({
  id: "nvr.example.com",
  label: "Office",
  business: "Kaj Consulting",
  device: { name: "NVR", model: "DS-7608NI-K2", serial: null, firmware: null },
  channels: [{ id: 1, name: "Front", online: true }, { id: 2, name: "Back", online: false }],
  disks: [{ id: "1", name: "hdd1", status: "ok", capacityMB: 1, freeMB: 0 }],
  checkedAt: "2026-10-02T10:00:00.000Z",
  ...over,
});

const reading = (over: Partial<SolarReading> = {}): SolarReading => ({ station: "home", at: "2026-10-02T10:00:00.000Z", powerW: 3000, todayKWh: 12, totalKWh: 100, batterySoc: 80, batteryW: 500, gridW: -200, loadW: 900, status: "normal", alarms: [], ...over });

describe("device tasks", () => {
  const modes = { cameras: "live" as const, solar: "live" as const };
  const base = { solar: [], solarSettings: DEFAULT_SOLAR_SETTINGS, timeZone: "UTC", modes, partial: { cameras: [] }, now: new Date("2026-10-02T10:05:00Z") };

  it("raises offline cameras, unhealthy disks and missing disks", () => {
    const { tasks } = deriveDeviceTasks({ ...base, cameras: [camSite(), camSite({ id: "b", label: "Shop", disks: [{ id: "1", name: "hdd1", status: "error", capacityMB: 1, freeMB: 0 }], channels: [] }), camSite({ id: "c", label: "Store", disks: [] })] });
    expect(tasks.map((t) => [t.id, t.severity])).toEqual([
      ["cameras/nvr.example.com:offline", "high"],
      ["cameras/b:disk:1", "critical"],
      ["cameras/c:offline", "high"],
      ["cameras/c:no-disk", "critical"],
    ]);
    expect(tasks[0].detail).toBe("Back");
  });

  it("doesn't flag a standalone camera without a disk, and leaves unreachable sites alone", () => {
    const { tasks, unobserved } = deriveDeviceTasks({ ...base, cameras: [camSite({ device: { name: null, model: "DS-2CD2143G2-I", serial: null, firmware: null }, disks: [], channels: [{ id: 1, name: "Cam", online: true }] })], partial: { cameras: ["far.example.com"] } });
    expect(tasks).toEqual([]);
    expect(unobserved).toEqual(["cameras/far.example.com:"]);
  });

  it("turns solar problems into tasks", () => {
    const stations = buildStations([reading({ at: "2026-10-02T09:00:00.000Z", status: "fault", alarms: ["Grid overvoltage"], batterySoc: 9 })], { home: "Home" }, "UTC", new Date("2026-10-02T10:05:00Z"));
    const { tasks } = deriveDeviceTasks({ ...base, cameras: [], solar: stations });
    expect(tasks.map((t) => [t.id, t.severity, t.business])).toEqual([
      ["solar/home:offline", "high", "Home"],
      ["solar/home:fault", "critical", "Home"],
    ]);
  });
});

describe("solar rules", () => {
  const now = new Date("2026-10-02T12:00:00Z");

  it("validates pushed readings", () => {
    expect(parseReading({ station: "Home", powerW: "2500", batterySoc: 140, gridW: -300, status: "Normal", alarms: ["a", 2] }, now)).toMatchObject({ station: "home", powerW: 2500, batterySoc: null, gridW: -300, status: "normal", alarms: ["a", "2"], at: now.toISOString() });
    expect(parseReading({ station: "../etc" }, now)).toMatch(/station/);
    expect(parseReading({ station: "home", at: "2026-10-03T12:00:00Z" }, now)).toMatch(/within/);
    expect(parseReading("nope", now)).toMatch(/object/);
    expect(parseReading({ station: "home", status: "exploded" }, now)).toMatchObject({ status: "unknown" });
  });

  it("only expects readings during daylight in the business time zone", () => {
    const st = buildStations([reading({ at: "2026-10-02T08:00:00.000Z" })], {}, "UTC", now);
    expect(deriveSolarTasks(st, DEFAULT_SOLAR_SETTINGS, "UTC", now).map((t) => t.key)).toEqual(["home:offline"]);
    // 12:00 UTC is 22:00 in Brisbane: night, so silence is expected.
    expect(deriveSolarTasks(st, DEFAULT_SOLAR_SETTINGS, "Australia/Brisbane", now)).toEqual([]);
  });

  it("warns on a low battery only while readings are fresh", () => {
    const fresh = buildStations([reading({ at: "2026-10-02T11:58:00.000Z", batterySoc: 10 })], {}, "UTC", now);
    expect(deriveSolarTasks(fresh, DEFAULT_SOLAR_SETTINGS, "UTC", now).map((t) => [t.key, t.severity])).toEqual([["home:battery-low", "medium"]]);
  });

  it("builds today's curve and daily energy from the best reading each day", () => {
    const st = buildStations(
      [reading({ at: "2026-10-01T15:00:00.000Z", todayKWh: 20 }), reading({ at: "2026-10-01T17:00:00.000Z", todayKWh: 22.46 }), reading({ at: "2026-10-02T09:00:00.000Z", todayKWh: 5, powerW: 1000 }), reading({ at: "2026-10-02T11:00:00.000Z", todayKWh: 9, powerW: 3500 })],
      {},
      "UTC",
      now,
    );
    expect(st[0].daily).toEqual([{ date: "2026-10-01", value: 22.5 }, { date: "2026-10-02", value: 9 }]);
    expect(st[0].todayCurve.map((p) => p.powerW)).toEqual([1000, 3500]);
    expect(st[0].latest.todayKWh).toBe(9);
  });
});

// ─── One-click fixes ─────────────────────────────────────────────────────────

describe("one-click fix matching", () => {
  it("matches failed deploys, paused projects and failed CI runs only", () => {
    expect(fixForTask("vercel/deploy-failed:prj_123", null)).toEqual({ kind: "vercel-redeploy", projectId: "prj_123", label: "Redeploy" });
    expect(fixForTask("supabase/paused:abcdefghijklmnopqrst", null)).toMatchObject({ kind: "supabase-restore", ref: "abcdefghijklmnopqrst" });
    expect(fixForTask("github-ci:kaj/site:CI:main", "https://github.com/kaj/site/actions/runs/123456")).toEqual({ kind: "github-rerun", repo: "kaj/site", runId: "123456", label: "Re-run failed jobs" });
    expect(fixForTask("github-ci:kaj/site:CI:main", "https://evil.example/kaj/site/actions/runs/1")).toBeNull();
    expect(fixForTask("supabase/paused:../../x", null)).toBeNull();
    expect(fixForTask("workers/deploy-failed:abc", null)).toBeNull();
    expect(fixForTask(null, null)).toBeNull();
  });
});

// ─── Brief and weekly report ─────────────────────────────────────────────────

const stripe = (business: string, daily: { date: string; gross: number }[], livemode = true): StripeAccountSummary => ({
  id: business,
  business,
  livemode,
  balance: [],
  revenue: [],
  daily: daily.map((d) => ({ ...d, currency: "usd" })),
  mrr: [],
  activeSubscriptions: 0,
  pastDueSubscriptions: 0,
  disputes: [],
  openInvoices: [],
  truncated: false,
});

describe("morning brief", () => {
  it("leads with the urgent count and escapes third-party text", () => {
    const b = renderBrief({
      date: "2026-10-02",
      dashboardUrl: "https://dash.example.com",
      tasks: [{ title: "<script>alert(1)</script> dispute", severity: "critical", business: "Kaj" }, { title: "Reply to ClientCo", severity: "high" }, { title: "Tidy", severity: "low" }],
      revenueYesterday: [{ currency: "usd", amount: 125000 }],
      signups24h: 2,
      meetingsToday: [{ title: "Standup", start: "2026-10-02T13:00:00.000Z", allDay: false }],
      solarYesterdayKWh: 18.4,
      camerasOffline: 1,
      timeZone: "UTC",
    });
    expect(b.subject).toContain("1 critical, 1 high");
    expect(b.text).toContain("Revenue yesterday: $1,250.00");
    expect(b.text).toContain("Solar yesterday: 18.4 kWh");
    expect(b.text).toContain("1:00 PM · Standup");
    expect(b.text).not.toContain("Tidy");
    expect(b.html).not.toContain("<script>");
    expect(b.html).toContain("&lt;script&gt;");
  });

  it("counts only live Stripe accounts for revenue", () => {
    expect(revenueOn([stripe("A", [{ date: "2026-10-01", gross: 100 }]), stripe("B", [{ date: "2026-10-01", gross: 50 }], false)], "2026-10-01")).toEqual([{ currency: "usd", amount: 100 }]);
  });
});

describe("weekly report", () => {
  it("adds up one business's week", () => {
    const r = buildWeeklyReport({
      business: "Kaj",
      to: "2026-10-04",
      stripe: [stripe("Kaj", [{ date: "2026-09-27", gross: 999 }, { date: "2026-09-28", gross: 100 }, { date: "2026-10-04", gross: 200 }, { date: "2026-09-21", gross: 50 }]), stripe("Other", [{ date: "2026-10-01", gross: 7 }])],
      siteChecks: [
        { domain: "kaj.com", status: "up", totalUsers: 10, at: "2026-09-28T00:00:00Z" },
        { domain: "kaj.com", status: "down", totalUsers: null, at: "2026-09-29T00:00:00Z" },
        { domain: "kaj.com", status: "up", totalUsers: 14, at: "2026-10-04T00:00:00Z" },
        { domain: "kaj.com", status: "up", totalUsers: 14, at: "2026-10-04T00:05:00Z" },
      ],
      tasksClosed: 6,
      open: [{ severity: "critical" }, { severity: "high" }, { severity: "high" }],
      deals: [
        { id: "1", clientId: null, clientName: "ClientCo", business: "Kaj", title: "Website rebuild", valueMinor: 500000, currency: "usd", stage: "won", expectedClose: null, nextStep: null, nextStepDue: null, closedOn: "2026-10-01", notes: null, updatedOn: "2026-10-01" },
        { id: "2", clientId: null, clientName: null, business: "Kaj", title: "Old win", valueMinor: 1, currency: "usd", stage: "won", expectedClose: null, nextStep: null, nextStepDue: null, closedOn: "2026-09-01", notes: null, updatedOn: "2026-09-01" },
      ],
      solar: [],
    });
    expect(r.from).toBe("2026-09-28");
    expect(r.revenue).toEqual([{ currency: "usd", amount: 300 }]);
    expect(r.revenuePrev).toEqual([{ currency: "usd", amount: 1049 }]);
    expect(r.newUsers).toBe(4);
    expect(r.sites).toEqual([{ domain: "kaj.com", checks: 4, uptimePct: 75 }]);
    expect([r.tasksClosed, r.openCritical, r.openHigh]).toEqual([6, 1, 2]);
    expect(r.dealsWon).toEqual([{ title: "Website rebuild", client: "ClientCo", value: { currency: "usd", amount: 500000 } }]);
    expect(r.solarKWh).toBeNull();
  });
});

describe("push subscriptions", () => {
  it("accepts only well-formed https subscriptions", () => {
    expect(validSubscription({ endpoint: "https://fcm.googleapis.com/fcm/send/x", keys: { p256dh: "a", auth: "b" } })).toBe(true);
    expect(validSubscription({ endpoint: "http://insecure/x", keys: { p256dh: "a", auth: "b" } })).toBe(false);
    expect(validSubscription({ endpoint: "https://x" })).toBe(false);
    expect(validSubscription(null)).toBe(false);
  });
});

// ─── Database-backed (PGlite) ────────────────────────────────────────────────

describe("solar ingest store", () => {
  beforeAll(async () => {
    await useDb(await pgliteDb());
  });
  beforeEach(async () => {
    const db = await getDb();
    await db.exec("truncate settings, snapshots, email_triage");
  });

  it("checks the bearer token against the env token or the stored hash", async () => {
    expect(await checkIngestToken("Bearer sol_abc")).toBe(false);
    await setSetting("solar_ingest_token_hash", sha256Hex("sol_abc"));
    expect(await checkIngestToken("Bearer sol_abc")).toBe(true);
    expect(await checkIngestToken("Bearer sol_abd")).toBe(false);
    expect(await checkIngestToken("sol_abc")).toBe(false);
    vi.stubEnv("SOLAR_INGEST_TOKEN", "from-env-token");
    expect(await checkIngestToken("Bearer from-env-token")).toBe(true);
  });

  it("skips a duplicate reading for the same station within 20 seconds", async () => {
    const at = new Date(Date.now() - 60_000).toISOString();
    expect(await storeReading(reading({ at }))).toBe(true);
    expect(await storeReading(reading({ at: new Date(Date.parse(at) + 10_000).toISOString() }))).toBe(false);
    expect(await storeReading(reading({ at: new Date(Date.parse(at) + 10_000).toISOString(), station: "office" }))).toBe(true);
    expect(await storeReading(reading({ at: new Date(Date.parse(at) + 30_000).toISOString() }))).toBe(true);
    // A change of state inside the window is still stored.
    expect(await storeReading(reading({ at: new Date(Date.parse(at) + 35_000).toISOString(), status: "fault", alarms: ["Grid overvoltage"] }))).toBe(true);
    expect((await loadReadings()).map((r) => r.station).sort()).toEqual(["home", "home", "home", "office"]);
  });

  it("loads one best reading per older day plus everything recent", async () => {
    const db = await getDb();
    const day = (daysAgo: number, hour: number) => {
      const d = new Date(Date.now() - daysAgo * 86_400_000);
      d.setUTCHours(hour, 0, 0, 0);
      return d.toISOString();
    };
    for (const [at, kwh] of [[day(5, 10), 10], [day(5, 16), 25], [day(5, 18), 24], [day(20, 12), 99]] as const) {
      await db.query("insert into snapshots (kind, key, data, taken_at) values ('solar', 'home', $1::text::jsonb, $2)", [JSON.stringify(reading({ at, todayKWh: kwh })), at]);
    }
    const rows = await loadReadings();
    expect(rows.map((r) => r.todayKWh)).toEqual([25]);
  });
});

describe("AI triage cache", () => {
  const mail = (id: string, unread = true): EmailMessage => ({ id, from: "a@b.c", subject: `S${id}`, snippet: "hi", receivedAt: "2026-10-02T08:00:00.000Z", unread, account: "Kaj", mailbox: "kaj@example.com", labels: [], severity: "low" });

  it("does nothing without an API key", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect(await triagePending([mail("1")])).toBe(0);
    expect(await withTriage([mail("1")])).toEqual([mail("1")]);
  });

  it("applies cached results and only triages new unread mail", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    const db = await getDb();
    await db.query("insert into email_triage (message_id, severity, summary, needs_reply, task) values ('1', 'high', 'Client asks for a quote', true, 'Send the quote')");
    const [m1] = await withTriage([mail("1")]);
    expect(m1).toMatchObject({ severity: "high", triage: { summary: "Client asks for a quote", needsReply: true, task: "Send the quote" } });
    expect((await cachedTriage(["1", "2"])).size).toBe(1);
  });
});
