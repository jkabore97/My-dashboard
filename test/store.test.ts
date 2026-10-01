import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, migrate, pgliteDb, postgresDb, useDb } from "@/lib/server/db";
import { addManualTask, completeTask, listTasks, reconcileDerived, resolveEventTask, setTaskBusiness, snoozeTask, upsertEventTask } from "@/lib/server/store/tasks";
import { listEvents, recordEvent } from "@/lib/server/store/events";
import { takeAttempt } from "@/lib/server/store/ratelimit";
import { attempt, loginLimit, succeeded } from "@/lib/server/limits";
import { listAudit } from "@/lib/server/store/audit";
import { claimInterval } from "@/lib/server/store/settings";
import { deleteConnection, listConnections, readConnections, saveConnection } from "@/lib/server/store/connections";
import { consumeRecoveryCode, ensureUser, markTotpStep, setRecoveryCodes } from "@/lib/server/store/users";
import type { Task } from "@/lib/types";
import { persist } from "@/lib/server/sync";
import { undecryptableGuards, type Collected } from "@/lib/aggregate";

const t = (id: string, extra: Partial<Task> = {}): Task => ({ id, title: id, severity: "high", source: "Test", createdAt: new Date().toISOString(), ...extra });

// Runs on in-memory PGlite by default; set TEST_DATABASE_URL to run the same
// suite against a real Postgres (the production driver behaves differently,
// e.g. in how it serializes jsonb parameters).
beforeAll(async () => {
  const url = process.env.TEST_DATABASE_URL;
  await useDb(url ? await postgresDb(url) : await pgliteDb());
});

beforeEach(async () => {
  const db = await getDb();
  await db.exec("truncate tasks, events, settings, connections, users, rate_limits, audit_log, snapshots");
});

describe("derived task reconciliation", () => {
  it("creates, keeps user state, auto-resolves and reopens", async () => {
    await reconcileDerived([t("github/a"), t("github/b")], ["github"]);
    expect((await listTasks("open")).map((x) => x.title).sort()).toEqual(["github/a", "github/b"]);

    const a = (await listTasks("open")).find((x) => x.title === "github/a")!;
    await completeTask(a.id);
    await reconcileDerived([t("github/a"), t("github/b")], ["github"]);
    expect((await listTasks("open")).map((x) => x.title)).toEqual(["github/b"]); // user's "done" sticks

    await reconcileDerived([], ["github"]); // both conditions cleared
    expect(await listTasks("open")).toHaveLength(0);
    const done = await listTasks("done");
    expect(done.every((x) => x.resolvedBy === "auto")).toBe(true);

    await reconcileDerived([t("github/a")], ["github"]); // problem came back
    expect((await listTasks("open")).map((x) => x.title)).toEqual(["github/a"]);
  });

  it("never touches scopes that weren't reported", async () => {
    await reconcileDerived([t("gmail/m1"), t("github/a")], ["gmail", "github"]);
    await reconcileDerived([], ["github"]); // gmail was down this round
    expect((await listTasks("open")).map((x) => x.title)).toEqual(["gmail/m1"]);
  });

  it("leaves unobserved parts of a live scope alone", async () => {
    await reconcileDerived([t("gmail/A/m1"), t("gmail/B/m2"), t("supabase/advisor:ref1:RLS")], ["gmail", "supabase"]);
    // Mailbox A and ref1's advisors failed this round; B answered with nothing.
    await reconcileDerived([], ["gmail", "supabase"], ["gmail/A/", "supabase/advisor:ref1:"]);
    expect((await listTasks("open")).map((x) => x.title).sort()).toEqual(["gmail/A/m1", "supabase/advisor:ref1:RLS"]);
  });

  it("closes tasks of a disconnected source, not of a failing one", async () => {
    await reconcileDerived([t("github/a"), t("gmail/A/m1")], ["github", "gmail"]);
    const c = (credentialsKnown: boolean) =>
      ({ modes: { github: "demo", gmail: "error", websites: "demo" }, derivedTasks: [], notifications: [], websites: [], unobserved: [], skipScopes: [], credentialsKnown }) as unknown as Collected;
    await persist(c(false), { force: true }); // connections unreadable: demo may not mean disconnected
    expect(await listTasks("open")).toHaveLength(2);
    await persist(c(true), { force: true });
    expect((await listTasks("open")).map((x) => x.title)).toEqual(["gmail/A/m1"]);
  });

  it("an undecryptable connection keeps its tasks open even when a fallback keeps the source live", async () => {
    await reconcileDerived([t("github/prs:a"), t("gmail/a%40x.co/m1"), t("gmail/b%40x.co/m2"), t("workers/deploy-failed:w")], ["github", "gmail", "workers"]);
    const guards = undecryptableGuards([{ provider: "github", account: "kaj" }, { provider: "gmail", account: "a@x.co" }]);
    const c = { modes: { github: "live", gmail: "live", workers: "live" }, derivedTasks: [], notifications: [], websites: [], credentialsKnown: false, ...guards } as unknown as Collected;
    await persist(c, { force: true }); // env token / other mailbox answered with nothing
    expect((await listTasks("open")).map((x) => x.title).sort()).toEqual(["github/prs:a", "gmail/a%40x.co/m1"]);
  });

  it("keeps a business override across refreshes", async () => {
    await reconcileDerived([t("github/a", { business: "Old" })], ["github"]);
    const [a] = await listTasks("open");
    await setTaskBusiness(a.id, "Kaj Store");
    await reconcileDerived([t("github/a", { business: "Old", title: "renamed" })], ["github"]);
    const [after] = await listTasks("open");
    expect(after.business).toBe("Kaj Store");
    expect(after.title).toBe("renamed");
  });

  it("snoozed tasks wake up when due", async () => {
    const m = await addManualTask({ title: "call accountant", severity: "medium" });
    await snoozeTask(m.id, new Date(Date.now() + 60_000));
    expect(await listTasks("open")).toHaveLength(0);
    expect(await listTasks("snoozed")).toHaveLength(1);
    await snoozeTask(m.id, new Date(Date.now() - 1000));
    expect((await listTasks("open"))[0].title).toBe("call accountant");
  });

  it("sorts by severity then recency", async () => {
    await addManualTask({ title: "low", severity: "low" });
    await addManualTask({ title: "crit", severity: "critical" });
    await addManualTask({ title: "med", severity: "medium" });
    expect((await listTasks("open")).map((x) => x.title)).toEqual(["crit", "med", "low"]);
  });
});

describe("event tasks", () => {
  it("open → resolve → reopen on recurrence", async () => {
    const now = new Date().toISOString();
    await upsertEventTask("github-ci:x", { title: "CI failing", severity: "high", source: "GitHub", createdAt: now });
    await upsertEventTask("github-ci:x", { title: "CI failing", severity: "high", source: "GitHub", createdAt: now });
    expect(await listTasks("open")).toHaveLength(1);
    await resolveEventTask("github-ci:x");
    expect(await listTasks("open")).toHaveLength(0);
    await upsertEventTask("github-ci:x", { title: "CI failing again", severity: "high", source: "GitHub", createdAt: now });
    expect((await listTasks("open"))[0].title).toBe("CI failing again");
  });
  it("reopens on recurrence after the user marked it done", async () => {
    const now = new Date().toISOString();
    await upsertEventTask("github-ci:y", { title: "CI failing", severity: "high", source: "GitHub", createdAt: now });
    const [task] = await listTasks("open");
    await completeTask(task.id);
    const userDoneAt = (await listTasks("done"))[0].resolvedAt;
    await resolveEventTask("github-ci:y"); // fixed
    const [done] = await listTasks("done");
    expect(done.resolvedBy).toBe("auto");
    expect(done.resolvedAt).toBe(userDoneAt); // keeps when the user closed it
    await upsertEventTask("github-ci:y", { title: "CI failing again", severity: "high", source: "GitHub", createdAt: now });
    expect((await listTasks("open")).map((x) => x.title)).toEqual(["CI failing again"]);
  });
  it("derived reconciliation ignores event tasks", async () => {
    await upsertEventTask("stripe-dispute:dp_1", { title: "dispute", severity: "critical", source: "Stripe", createdAt: new Date().toISOString() });
    await reconcileDerived([], ["github", "connector"]);
    expect(await listTasks("open")).toHaveLength(1);
  });
});

describe("settings", () => {
  it("round-trips JSON values without double-encoding", async () => {
    const { getSetting, setSetting } = await import("@/lib/server/store/settings");
    await setSetting("k", { a: [1, "x"], b: null });
    expect(await getSetting("k", null)).toEqual({ a: [1, "x"], b: null });
    await setSetting("k2", "plain");
    expect(await getSetting("k2", null)).toBe("plain");
    const db = await getDb();
    const [row] = await db.query<{ t: string }>("select jsonb_typeof(value) as t from settings where key = 'k'");
    expect(row.t).toBe("object");
  });
});

describe("events, rate limits, intervals", () => {
  it("dedupes events", async () => {
    const e = { dedupeKey: "k1", source: "Test", kind: "x", title: "hello", severity: "low" as const };
    expect(await recordEvent(e)).toBe(true);
    expect(await recordEvent(e)).toBe(false);
    expect(await listEvents()).toHaveLength(1);
  });
  it("counts attempts in a window", async () => {
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await takeAttempt("k:1.2.3.4", 60));
    expect(results).toEqual([1, 2, 3, 4]);
  });
  it("other IPs' failures never block the correct password from a trusted IP", async () => {
    for (let i = 0; i < 50; i++) expect(await attempt(loginLimit(`10.0.0.${i}`, "owner"), "owner", `10.0.0.${i}`)).toBe(true);
    const mine = loginLimit("192.0.2.1", "owner");
    for (let i = 0; i < 9; i++) await attempt(mine, "owner", "192.0.2.1"); // 9 own failures
    expect(await attempt(mine, "owner", "192.0.2.1")).toBe(true); // correct password
    await succeeded(mine); // ...isn't counted
    expect(await attempt(mine, "owner", "192.0.2.1")).toBe(true); // 10th failure still allowed
    expect(await attempt(mine, "owner", "192.0.2.1")).toBe(false);
    expect((await listAudit(10)).filter((a) => a.action === "login.rate_limited")).toHaveLength(1);
  });
  it("an unknown IP falls back to a loose bucket for the identity", async () => {
    const l = loginLimit(null, "owner");
    expect(l).toMatchObject({ key: "login:unknown-ip:owner", limit: 100 });
    for (let i = 0; i < 100; i++) expect(await attempt(l, "owner", null)).toBe(true);
    expect(await attempt(l, "owner", null)).toBe(false);
    expect(await attempt(l, "owner", null)).toBe(false);
    expect((await listAudit(10)).filter((a) => a.action === "login.rate_limited")).toHaveLength(1);
  });
  it("claims an interval once", async () => {
    expect(await claimInterval("job:test", 60)).toBe(true);
    expect(await claimInterval("job:test", 60)).toBe(false);
    expect(await claimInterval("job:test", 0)).toBe(true);
  });
});

describe("connections and users", () => {
  it("stores secrets encrypted", async () => {
    await saveConnection({ provider: "github", account: "kaj", secret: { token: "ghp_supersecret" } });
    const db = await getDb();
    const [raw] = await db.query<{ secret: string }>("select secret from connections");
    expect(raw.secret).not.toContain("ghp_supersecret");
    const [c] = await listConnections<{ token: string }>("github");
    expect(c.secret.token).toBe("ghp_supersecret");
    await deleteConnection(c.id);
    expect(await listConnections("github")).toHaveLength(0);
  });
  it("a new connection replaces the provider's old one, except for Gmail", async () => {
    expect(await saveConnection({ provider: "vercel", account: "team-a", secret: { token: "a" } })).toEqual([]);
    expect(await saveConnection({ provider: "vercel", account: "team-b", secret: { token: "b" } })).toEqual(["team-a"]);
    expect((await listConnections("vercel")).map((c) => c.account)).toEqual(["team-b"]);
    await saveConnection({ provider: "gmail", account: "a@x.co", secret: { refreshToken: "1" } });
    expect(await saveConnection({ provider: "gmail", account: "b@x.co", secret: { refreshToken: "2" } })).toEqual([]);
    expect(await listConnections("gmail")).toHaveLength(2);
  });
  it("reports rows that no longer decrypt, so credentials count as unknown", async () => {
    await saveConnection({ provider: "github", account: "kaj", secret: { token: "t" } });
    await saveConnection({ provider: "gmail", account: "a@x.co", secret: { refreshToken: "r" } });
    const { connectionHealth } = await import("@/lib/server/credentials");
    expect(await connectionHealth()).toEqual({ readable: true, undecryptable: [] });
    const db = await getDb();
    await db.query("update connections set secret = 'v1:AAAA:BBBB:CCCC' where provider = 'github'"); // as if ENCRYPTION_KEY changed
    const { list, undecryptable } = await readConnections();
    expect(list.map((c) => c.provider)).toEqual(["gmail"]);
    expect(undecryptable).toEqual([{ provider: "github", account: "kaj" }]);
    expect(await connectionHealth()).toEqual({ readable: false, undecryptable: [{ provider: "github", account: "kaj" }] });
  });
  it("TOTP-only verification never consumes a recovery code", async () => {
    const { generateSecret, totp } = await import("@/lib/server/totp");
    const { encrypt } = await import("@/lib/server/crypto");
    const { newRecoveryCodes, verifySecondFactor, verifyTotpOnly } = await import("@/lib/server/twofactor");
    const { enableTotp } = await import("@/lib/server/store/users");
    const secret = generateSecret();
    const { codes, hashes } = newRecoveryCodes(2);
    await ensureUser("t@x.co");
    await enableTotp("t@x.co", encrypt(secret), 0, hashes);
    expect(await verifyTotpOnly("t@x.co", codes[0])).toBe(false);
    expect(await verifySecondFactor("t@x.co", codes[0])).toBe("recovery"); // still unused
    const code = totp(secret);
    expect(await verifyTotpOnly("t@x.co", code)).toBe(true);
    expect(await verifyTotpOnly("t@x.co", code)).toBe(false); // no replay
    expect(await verifySecondFactor("t@x.co", "000000")).toBe(null);
  });
  it("TOTP steps only move forward; recovery codes are single-use", async () => {
    await ensureUser("a@b.c");
    expect(await markTotpStep("a@b.c", 100)).toBe(true);
    expect(await markTotpStep("a@b.c", 100)).toBe(false);
    expect(await markTotpStep("a@b.c", 99)).toBe(false);
    await setRecoveryCodes("a@b.c", ["h1", "h2"]);
    expect(await consumeRecoveryCode("a@b.c", "h1")).toBe(true);
    expect(await consumeRecoveryCode("a@b.c", "h1")).toBe(false);
  });
});

describe("migrations", () => {
  it("enables RLS on schema_migrations too", async () => {
    const db = await getDb();
    const rows = await db.query<{ relname: string; relrowsecurity: boolean }>(
      "select relname, relrowsecurity from pg_class where relkind = 'r' and relnamespace = 'public'::regnamespace",
    );
    expect(rows.find((r) => r.relname === "schema_migrations")?.relrowsecurity).toBe(true);
    expect(rows.every((r) => r.relrowsecurity)).toBe(true);
  });

  it.skipIf(!process.env.TEST_DATABASE_URL)("survives concurrent cold starts on a fresh database", async () => {
    const url = new URL(process.env.TEST_DATABASE_URL!);
    const name = `kcc_mig_${Date.now()}`;
    const admin = await getDb();
    await admin.exec(`create database ${name}`);
    try {
      url.pathname = `/${name}`;
      const dbs = await Promise.all(Array.from({ length: 4 }, () => postgresDb(url.toString())));
      await Promise.all(dbs.map((db) => migrate(db)));
      const [{ n }] = await dbs[0].query<{ n: number }>("select count(*)::int as n from schema_migrations");
      expect(n).toBeGreaterThan(0);
    } finally {
      await admin.exec(`drop database if exists ${name} with (force)`);
    }
  });
});
