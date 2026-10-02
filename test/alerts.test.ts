import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sendNotification: vi.fn(async (..._a: unknown[]) => ({})),
  user: null as unknown,
}));
vi.mock("web-push", () => ({ default: { setVapidDetails: () => {}, sendNotification: mocks.sendNotification } }));
vi.mock("@/lib/server/auth", async (orig) => ({ ...(await orig<object>()), currentUser: async () => mocks.user }));

import { getDb, pgliteDb, useDb } from "@/lib/server/db";
import { decide, DEFAULT_PREFS, inQuietHours, nextLocalHour, normalizePrefs, routeAfter, splitForRateLimit, type NotifyPrefs } from "@/lib/server/alerts/decide";
import { runAlerts } from "@/lib/server/alerts/run";
import { bellFor, deliveryLog } from "@/lib/server/alerts/store";
import { authorizeTick, createTickToken } from "@/lib/server/alerts/tick";
import { completeTask, reconcileDerived, reopenTask, upsertEventTask } from "@/lib/server/store/tasks";
import { POST as actionPOST } from "@/app/api/notifications/action/route";
import { GET as tickGET } from "@/app/api/tick/[token]/route";
import { GET as tickBearerGET } from "@/app/api/tick/route";
import type { Severity } from "@/lib/types";

const prefs = (p: Partial<NotifyPrefs> = {}): NotifyPrefs => ({ ...DEFAULT_PREFS, ...p });
const at = (iso: string) => new Date(iso);
const NY = "America/New_York";
const OUAGA = "Africa/Ouagadougou";

afterEach(() => {
  vi.unstubAllEnvs();
});

// ─── The pure decision ───────────────────────────────────────────────────────

describe("decide()", () => {
  const high = (now: string, p: Partial<NotifyPrefs> = {}) => decide({ severity: "high", kind: "alert", prefs: prefs(p), now: at(now) });

  it("sends critical at once, even in quiet hours and while paused", () => {
    const d = decide({ severity: "critical", kind: "alert", prefs: prefs({ timeZone: NY, pausedUntil: "2026-10-03T00:00:00Z" }), now: at("2026-10-02T04:00:00Z") });
    expect(d).toEqual({ action: "now" });
  });

  it("holds high alerts through quiet hours across midnight in New York", () => {
    // 21:59 EDT: still awake; 22:00: quiet.
    expect(high("2026-10-02T01:59:00Z", { timeZone: NY })).toEqual({ action: "now" });
    expect(high("2026-10-02T02:00:00Z", { timeZone: NY })).toMatchObject({ action: "queue", until: at("2026-10-02T11:00:00Z"), reason: "quiet hours" });
    // 23:30 EDT → 07:00 EDT the next morning; 03:00 EDT → 07:00 the same morning.
    expect(high("2026-10-02T03:30:00Z", { timeZone: NY })).toMatchObject({ action: "queue", until: at("2026-10-02T11:00:00Z") });
    expect(high("2026-10-02T07:00:00Z", { timeZone: NY })).toMatchObject({ action: "queue", until: at("2026-10-02T11:00:00Z") });
    expect(high("2026-10-02T11:00:00Z", { timeZone: NY })).toEqual({ action: "now" });
  });

  it("uses Ouagadougou time (UTC+0, no DST)", () => {
    expect(high("2026-10-02T23:00:00Z", { timeZone: OUAGA })).toMatchObject({ action: "queue", until: at("2026-10-03T07:00:00Z") });
    expect(high("2026-10-03T06:59:00Z", { timeZone: OUAGA })).toMatchObject({ action: "queue", until: at("2026-10-03T07:00:00Z") });
    expect(high("2026-10-03T07:00:00Z", { timeZone: OUAGA })).toEqual({ action: "now" });
    // The same instant is daytime in Ouagadougou but quiet in New York.
    expect(high("2026-10-03T03:00:00Z", { timeZone: OUAGA })).toMatchObject({ action: "queue" });
    expect(high("2026-10-02T21:00:00Z", { timeZone: OUAGA })).toEqual({ action: "now" });
    expect(high("2026-10-03T02:30:00Z", { timeZone: NY })).toMatchObject({ action: "queue" });
  });

  it("gets 7 AM right across daylight-saving changes", () => {
    // Fall back (Nov 1 2026): 23:30 EDT → 07:00 EST = 12:00Z.
    expect(high("2026-11-01T03:30:00Z", { timeZone: NY })).toMatchObject({ until: at("2026-11-01T12:00:00Z") });
    // Spring forward (Mar 8 2026): 01:30 EST → 07:00 EDT = 11:00Z.
    expect(high("2026-03-08T06:30:00Z", { timeZone: NY })).toMatchObject({ until: at("2026-03-08T11:00:00Z") });
    expect(inQuietHours(at("2026-03-08T12:00:00Z"), prefs(), NY)).toBe(false);
  });

  it("supports quiet hours inside one day, and none at all", () => {
    expect(high("2026-10-02T14:00:00Z", { timeZone: "UTC", quietFrom: 13, quietTo: 15 })).toMatchObject({ until: at("2026-10-02T15:00:00Z") });
    expect(high("2026-10-02T03:00:00Z", { timeZone: "UTC", quietFrom: 0, quietTo: 0 })).toEqual({ action: "now" });
  });

  it("holds non-critical while paused, then through quiet hours if the pause ends in them", () => {
    expect(high("2026-10-02T15:00:00Z", { timeZone: OUAGA, pausedUntil: "2026-10-02T16:00:00Z" })).toMatchObject({ action: "queue", until: at("2026-10-02T16:00:00Z"), reason: "paused" });
    expect(high("2026-10-02T21:00:00Z", { timeZone: OUAGA, pausedUntil: "2026-10-02T23:00:00Z" })).toMatchObject({ until: at("2026-10-03T07:00:00Z") });
    expect(high("2026-10-02T15:00:00Z", { timeZone: OUAGA, pausedUntil: "2026-10-02T14:00:00Z" })).toEqual({ action: "now" }); // expired
  });

  it("queues medium for the next noon digest in the person's zone", () => {
    const med = (now: string, p: Partial<NotifyPrefs>) => decide({ severity: "medium", kind: "alert", prefs: prefs(p), now: at(now) });
    expect(med("2026-10-02T15:00:00Z", { timeZone: NY })).toMatchObject({ action: "queue", digest: true, until: at("2026-10-02T16:00:00Z") });
    expect(med("2026-10-02T16:00:00Z", { timeZone: NY })).toMatchObject({ until: at("2026-10-03T16:00:00Z") });
    expect(med("2026-10-02T09:00:00Z", { timeZone: OUAGA })).toMatchObject({ until: at("2026-10-02T12:00:00Z") });
    expect(med("2026-10-02T09:00:00Z", { timeZone: OUAGA, digest: false })).toMatchObject({ action: "skip" });
    // High with instant high alerts off joins the digest.
    expect(decide({ severity: "high", kind: "alert", prefs: prefs({ timeZone: OUAGA, high: false }), now: at("2026-10-02T09:00:00Z") })).toMatchObject({ digest: true, until: at("2026-10-02T12:00:00Z") });
  });

  it("never pushes low", () => {
    expect(decide({ severity: "low", kind: "alert", prefs: prefs(), now: at("2026-10-02T12:00:00Z") })).toMatchObject({ action: "skip" });
  });

  it("sends Resolved only for critical/high, when on, outside quiet hours (never queued)", () => {
    const res = (severity: Severity, now: string, p: Partial<NotifyPrefs> = {}) => decide({ severity, kind: "resolved", prefs: prefs({ timeZone: OUAGA, ...p }), now: at(now) });
    expect(res("critical", "2026-10-02T12:00:00Z")).toEqual({ action: "now" });
    expect(res("high", "2026-10-02T12:00:00Z")).toEqual({ action: "now" });
    expect(res("medium", "2026-10-02T12:00:00Z").action).toBe("skip");
    expect(res("critical", "2026-10-02T23:00:00Z")).toEqual({ action: "skip", reason: "quiet hours" });
    expect(res("critical", "2026-10-02T12:00:00Z", { resolved: false }).action).toBe("skip");
  });

  it("falls back to the business zone, and cleans stored preferences", () => {
    const d = decide({ severity: "high", kind: "alert", prefs: prefs(), now: at("2026-10-02T03:30:00Z"), fallbackZone: NY });
    expect(d).toMatchObject({ action: "queue", until: at("2026-10-02T11:00:00Z") });
    expect(normalizePrefs({ timeZone: "Mars/Base", quietFrom: 25, high: "yes", pausedUntil: "soon" })).toEqual(DEFAULT_PREFS);
    expect(normalizePrefs({ timeZone: OUAGA, quietFrom: 23, quietTo: 6, digest: false })).toMatchObject({ timeZone: OUAGA, quietFrom: 23, quietTo: 6, digest: false, high: true });
    expect(nextLocalHour(at("2026-10-02T12:00:00Z"), 12, OUAGA)).toEqual(at("2026-10-03T12:00:00Z"));
  });

  it("waits for a second look at website problems, and folds pushes over the limit", () => {
    const t = at("2026-10-02T12:00:00Z");
    expect(routeAfter("websites/down:x.com", t)).toEqual(at("2026-10-02T12:04:00Z"));
    expect(routeAfter("stripe-dispute:dp_1", t)).toEqual(t);
    const seven = [1, 2, 3, 4, 5, 6, 7];
    expect(splitForRateLimit(seven, 0)).toEqual({ individual: [1, 2, 3, 4], folded: [5, 6, 7] });
    expect(splitForRateLimit([1, 2, 3], 0)).toEqual({ individual: [1, 2, 3], folded: [] });
    expect(splitForRateLimit([1, 2], 5)).toEqual({ individual: [], folded: [1, 2] });
    expect(splitForRateLimit([1, 2], 3)).toEqual({ individual: [1, 2], folded: [] });
  });
});

// ─── Routing against a database ──────────────────────────────────────────────

const NO_QUIET = '{"quietFrom":0,"quietTo":0,"timeZone":"UTC"}';
const sentTo = () => mocks.sendNotification.mock.calls.map(([sub]) => (sub as { endpoint: string }).endpoint.replace("https://push.example/", "")).sort();
const payloads = () => mocks.sendNotification.mock.calls.map(([, body]) => JSON.parse(body as string));
const minutes = (n: number) => new Date(Date.now() + n * 60_000);

async function task(key: string, severity: Severity, extra: { business?: string; source?: string } = {}) {
  await upsertEventTask(key, { title: `Problem ${key}`, severity, source: extra.source ?? "Test", business: extra.business, createdAt: new Date().toISOString() });
  const db = await getDb();
  const [row] = await db.query<{ id: string }>("select id from tasks where source_key = $1", [key]);
  return row.id;
}

describe("alert routing (PGlite)", () => {
  beforeAll(async () => {
    await useDb(await pgliteDb());
  });
  beforeEach(async () => {
    vi.stubEnv("VAPID_PUBLIC_KEY", "pub");
    vi.stubEnv("VAPID_PRIVATE_KEY", "priv");
    vi.stubEnv("ALLOWED_EMAILS", "boss@kaj.com");
    vi.stubEnv("BUSINESS_TIMEZONE", "UTC");
    const db = await getDb();
    await db.exec("truncate tasks, task_activity, users, push_subscriptions, settings, alert_log, alert_incidents, audit_log cascade");
    await db.query(`insert into users (email, notify_prefs) values ('boss@kaj.com', $1::text::jsonb)`, [NO_QUIET]);
    await db.query(
      `insert into users (email, role, businesses, notify_prefs) values
        ('dev@kaj.com', 'developer', '["Kaj Store"]'::jsonb, $1::text::jsonb),
        ('acc@kaj.com', 'accountant', '["Kaj Consulting"]'::jsonb, $1::text::jsonb),
        ('amy@kaj.com', 'assistant', '["Kaj Store"]'::jsonb, $1::text::jsonb)`,
      [NO_QUIET],
    );
    for (const who of ["boss@kaj.com", "dev@kaj.com", "acc@kaj.com", "amy@kaj.com"]) {
      await db.query("insert into push_subscriptions (endpoint, owner, keys) values ($1, $2, '{\"p256dh\":\"a\",\"auth\":\"b\"}'::jsonb)", [`https://push.example/${who}`, who]);
    }
    mocks.sendNotification.mockReset();
    mocks.sendNotification.mockImplementation(async () => ({}));
  });

  it("sends each alert only to people whose role and businesses let them see it", async () => {
    await task("github-ci:kaj/store:ci:main", "critical", { business: "Kaj Store" }); // repos section
    await task("stripe-dispute:dp_9", "critical", { business: "Kaj Consulting" }); // money
    await task("github-ci:kaj/other:ci:main", "critical"); // no business: only people who see every business
    await runAlerts();
    const byTag = new Map<string, string[]>();
    for (const [sub, body] of mocks.sendNotification.mock.calls) {
      const p = JSON.parse(body as string);
      byTag.set(p.title, [...(byTag.get(p.title) ?? []), (sub as { endpoint: string }).endpoint.replace("https://push.example/", "")].sort());
    }
    expect(byTag.get("Critical: Problem github-ci:kaj/store:ci:main")).toEqual(["boss@kaj.com", "dev@kaj.com"]);
    expect(byTag.get("Critical: Problem stripe-dispute:dp_9")).toEqual(["acc@kaj.com", "boss@kaj.com"]);
    expect(byTag.get("Critical: Problem github-ci:kaj/other:ci:main")).toEqual(["boss@kaj.com"]);
    // A member's bell and delivery log hold only their own rows; the owner's log holds everyone's.
    const dev = { email: "dev@kaj.com", role: "developer" as const, businesses: ["Kaj Store"] };
    expect((await bellFor(dev)).items.map((i) => i.title)).toEqual(["Critical: Problem github-ci:kaj/store:ci:main"]);
    expect((await deliveryLog(dev, false)).every((r) => r.userEmail === "dev@kaj.com")).toBe(true);
    expect(new Set((await deliveryLog({ email: "boss@kaj.com", role: "owner", businesses: null }, true)).map((r) => r.userEmail)).size).toBe(3);
  });

  it("alerts the assignee even outside their sections", async () => {
    const id = await task("stripe-dispute:dp_7", "critical", { business: "Kaj Store" });
    const db = await getDb();
    await db.query("update tasks set assignee = 'amy@kaj.com' where id = $1", [id]);
    await runAlerts();
    expect(sentTo()).toEqual(["amy@kaj.com", "boss@kaj.com"]);
  });

  it("alerts once per open period, again when it reopens, and says Resolved only to those alerted", async () => {
    const id = await task("stripe-dispute:dp_1", "critical", { business: "Kaj Consulting" });
    expect((await runAlerts()).sent).toBe(2);
    expect((await runAlerts()).sent).toBe(0);
    await completeTask(id);
    const r = await runAlerts();
    expect(r.closed).toBe(1);
    expect(r.sent).toBe(2);
    const resolved = payloads().filter((p) => p.kind === "resolved");
    expect(resolved).toHaveLength(2);
    expect(resolved[0]).toMatchObject({ tag: `task-${id}`, title: "Resolved: Problem stripe-dispute:dp_1" });
    expect(resolved[0].actions).toBeUndefined();
    await reopenTask(id);
    expect((await runAlerts()).sent).toBe(2);
    const db = await getDb();
    const [inc] = await db.query<{ period: number }>("select period from alert_incidents where task_id = $1", [id]);
    expect(inc.period).toBe(2);

    // Never alerted (medium waits for the digest): no Resolved when it closes.
    mocks.sendNotification.mockClear();
    const med = await task("stripe-dispute:dp_2", "medium", { business: "Kaj Consulting" });
    await runAlerts();
    await completeTask(med);
    const after = await runAlerts();
    expect(after.closed).toBe(1);
    expect(mocks.sendNotification).not.toHaveBeenCalled();
    const rows = await db.query<{ kind: string; status: string; reason: string }>("select kind, status, reason from alert_log where task_id = $1", [med]);
    expect(rows.every((x) => x.kind === "alert" && x.status === "suppressed" && x.reason === "resolved before delivery")).toBe(true);
  });

  it("doesn't push tasks that were open long before alerting existed", async () => {
    const id = await task("stripe-dispute:dp_old", "critical");
    const db = await getDb();
    await db.query("update tasks set created_at = now() - interval '3 days', occurred_at = now() - interval '3 days' where id = $1", [id]);
    await runAlerts();
    expect(mocks.sendNotification).not.toHaveBeenCalled();
  });

  it("confirms a website problem with a second check before pushing", async () => {
    const down = (d: string) => ({ id: `websites/down:${d}`, title: `${d} is down`, severity: "critical" as const, source: "Website monitor", createdAt: new Date().toISOString() });
    await reconcileDerived([down("blip.com"), down("dead.com")], ["websites"]);
    await runAlerts({ now: minutes(0) });
    expect(mocks.sendNotification).not.toHaveBeenCalled();
    await reconcileDerived([down("dead.com")], ["websites"]); // blip.com recovered within the window
    await runAlerts({ now: minutes(3) });
    expect(mocks.sendNotification).not.toHaveBeenCalled();
    await runAlerts({ now: minutes(5) });
    expect(payloads().map((p) => p.title)).toEqual(["Critical: dead.com is down"]);
    const db = await getDb();
    const [{ n }] = await db.query<{ n: number }>("select count(*)::int as n from alert_log l join tasks t on t.id = l.task_id where t.source_key = 'websites/down:blip.com'");
    expect(n).toBe(0); // never alerted, so no Resolved either
  });

  it("folds more than 5 pushes in 10 minutes into one summary", async () => {
    for (let i = 0; i < 8; i++) await task(`stripe-dispute:many_${i}`, "critical"); // no business: boss only
    const r = await runAlerts();
    expect(mocks.sendNotification).toHaveBeenCalledTimes(5);
    expect(r.folded).toBe(4);
    const last = payloads().at(-1);
    expect(last).toMatchObject({ kind: "digest", title: "4 more alerts" });
    const db = await getDb();
    const counts = await db.query<{ status: string; n: number }>("select status, count(*)::int as n from alert_log group by status order by status");
    expect(counts).toEqual([{ status: "folded", n: 4 }, { status: "sent", n: 5 }]);
    // The next one within the window is folded too (one summary push).
    await task("stripe-dispute:many_9", "critical");
    await runAlerts();
    expect(mocks.sendNotification).toHaveBeenCalledTimes(6);
    expect(payloads().at(-1)).toMatchObject({ kind: "digest", title: "1 more alert" });
  });

  it("drops a queued alert when the task closes before quiet hours end", async () => {
    const h = new Date().getUTCHours();
    const db = await getDb();
    await db.query("update users set notify_prefs = $1::text::jsonb where email = 'boss@kaj.com'", [JSON.stringify({ timeZone: "UTC", quietFrom: h, quietTo: (h + 2) % 24 })]);
    const id = await task("stripe-dispute:night", "high");
    await runAlerts();
    expect(mocks.sendNotification).not.toHaveBeenCalled();
    const [queued] = await db.query<{ status: string; reason: string; deliver_after: Date }>("select status, reason, deliver_after from alert_log where task_id = $1", [id]);
    expect(queued).toMatchObject({ status: "queued", reason: "quiet hours" });
    await completeTask(id);
    await runAlerts({ now: minutes(180) });
    expect(mocks.sendNotification).not.toHaveBeenCalled();
    const [after] = await db.query<{ status: string; reason: string }>("select status, reason from alert_log where task_id = $1", [id]);
    expect(after).toEqual({ status: "suppressed", reason: "resolved before delivery" });
  });

  it("sends one noon digest per person for medium items", async () => {
    await task("stripe-dispute:m1", "medium");
    await task("stripe-dispute:m2", "medium");
    await runAlerts();
    expect(mocks.sendNotification).not.toHaveBeenCalled();
    await runAlerts({ now: nextLocalHour(new Date(), 12, "UTC") });
    expect(payloads()).toEqual([expect.objectContaining({ kind: "digest", title: "Noon digest: 2 items" })]);
    expect(sentTo()).toEqual(["boss@kaj.com"]);
  });

  it("never double-sends when two runs overlap", async () => {
    await task("stripe-dispute:race", "critical", { business: "Kaj Consulting" });
    await Promise.all([runAlerts(), runAlerts(), runAlerts()]);
    expect(sentTo()).toEqual(["acc@kaj.com", "boss@kaj.com"]);
  });

  describe("notification actions", () => {
    const post = (body: unknown, headers: Record<string, string> = { "content-type": "application/json" }) =>
      actionPOST(new Request("https://dash.example/api/notifications/action", { method: "POST", headers, body: JSON.stringify(body) }));
    const as = (email: string, role: string, businesses: string[] | null) => {
      mocks.user = { email, role, businesses, name: email, hasTotp: true, envOwner: false };
    };

    it("only lets the owner of a log row act on it", async () => {
      const id = await task("github-ci:kaj/store:ci:main", "critical", { business: "Kaj Store" });
      await runAlerts();
      const db = await getDb();
      const [devRow] = await db.query<{ id: string }>("select id from alert_log where user_email = 'dev@kaj.com'");

      mocks.user = null;
      expect((await post({ id: devRow.id, action: "ack" })).status).toBe(401);
      as("acc@kaj.com", "accountant", ["Kaj Consulting"]);
      expect((await post({ id: devRow.id, action: "ack" })).status).toBe(404);
      expect((await post({ id: devRow.id, action: "snooze" })).status).toBe(404);
      as("dev@kaj.com", "developer", ["Kaj Store"]);
      expect((await post({ id: devRow.id, action: "ack" }, { "content-type": "text/plain" })).status).toBe(415);
      expect((await post({ id: devRow.id, action: "ack" }, { "content-type": "application/json", origin: "https://evil.example" })).status).toBe(403);
      expect((await post({ id: devRow.id, action: "nuke" })).status).toBe(400);

      expect((await post({ id: devRow.id, action: "ack" })).status).toBe(200);
      const rows = await db.query<{ user_email: string; acked_at: Date | null }>("select user_email, acked_at from alert_log where task_id = $1 order by user_email", [id]);
      expect(rows.map((r) => [r.user_email, !!r.acked_at])).toEqual([["boss@kaj.com", false], ["dev@kaj.com", true]]);

      expect((await post({ id: devRow.id, action: "snooze" })).status).toBe(200);
      const [t] = await db.query<{ status: string; snoozed_until: Date }>("select status, snoozed_until from tasks where id = $1", [id]);
      expect(t.status).toBe("snoozed");
      expect(Math.abs(new Date(t.snoozed_until).getTime() - Date.now() - 3_600_000)).toBeLessThan(60_000);
    });

    it("refuses to snooze a task the person can no longer see", async () => {
      await task("github-ci:kaj/store:ci:main", "critical", { business: "Kaj Store" });
      await runAlerts();
      const db = await getDb();
      const [devRow] = await db.query<{ id: string }>("select id from alert_log where user_email = 'dev@kaj.com'");
      as("dev@kaj.com", "developer", ["Kaj Consulting"]); // moved to another business since
      expect((await post({ id: devRow.id, action: "snooze" })).status).toBe(403);
    });

    it("acknowledging drops what is still queued for that person", async () => {
      const h = new Date().getUTCHours();
      const db = await getDb();
      await db.query("update users set notify_prefs = $1::text::jsonb where email = 'dev@kaj.com'", [JSON.stringify({ timeZone: "UTC", quietFrom: h, quietTo: (h + 2) % 24 })]);
      const id = await task("github-ci:kaj/store:ci:x", "high", { business: "Kaj Store" });
      await runAlerts();
      const [row] = await db.query<{ id: string; status: string }>("select id, status from alert_log where user_email = 'dev@kaj.com' and task_id = $1", [id]);
      expect(row.status).toBe("queued");
      as("dev@kaj.com", "developer", ["Kaj Store"]);
      expect((await post({ id: row.id, action: "ack" })).status).toBe(200);
      const [after] = await db.query<{ status: string; reason: string }>("select status, reason from alert_log where id = $1", [row.id]);
      expect(after).toEqual({ status: "suppressed", reason: "acknowledged" });
    });
  });

  describe("scheduler tick", () => {
    it("accepts only the current link token or the cron secret", async () => {
      expect(await authorizeTick("tick_anything", null)).toBe(false);
      const token = await createTickToken();
      const db = await getDb();
      const [{ value }] = await db.query<{ value: string }>("select value from settings where key = 'tick_token_hash'");
      expect(value).not.toContain(token); // only the hash is stored
      expect(await authorizeTick(token, null)).toBe(true);
      expect(await authorizeTick(`${token}x`, null)).toBe(false);
      vi.stubEnv("CRON_SECRET", "cron-secret-0123456789");
      expect(await authorizeTick(null, "Bearer cron-secret-0123456789")).toBe(true);
      expect(await authorizeTick(null, "Bearer nope")).toBe(false);
      const replaced = await createTickToken();
      expect(await authorizeTick(token, null)).toBe(false);
      expect(await authorizeTick(replaced, null)).toBe(true);
    });

    it("answers 401 to a wrong link and skips while another run holds the lease", async () => {
      const token = await createTickToken();
      const call = (t: string) => tickGET(new Request(`https://dash.example/api/tick/${t}`), { params: Promise.resolve({ token: t }) });
      expect((await call("tick_wrong")).status).toBe(401);
      expect((await tickBearerGET(new Request("https://dash.example/api/tick"))).status).toBe(401);
      const db = await getDb();
      await db.query("insert into settings (key, value, updated_at) values ('job:tick', 'null', now())"); // a run just started
      const res = await call(token);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({ ok: true, skipped: expect.any(String) });
      expect(JSON.stringify(body)).not.toContain(token);
    });
  });
});
