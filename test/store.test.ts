import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, pgliteDb, postgresDb, useDb } from "@/lib/server/db";
import { addManualTask, completeTask, listTasks, reconcileDerived, resolveEventTask, setTaskBusiness, snoozeTask, upsertEventTask } from "@/lib/server/store/tasks";
import { listEvents, recordEvent } from "@/lib/server/store/events";
import { hitRateLimit } from "@/lib/server/store/ratelimit";
import { claimInterval } from "@/lib/server/store/settings";
import { deleteConnection, listConnections, saveConnection } from "@/lib/server/store/connections";
import { consumeRecoveryCode, ensureUser, markTotpStep, setRecoveryCodes } from "@/lib/server/store/users";
import type { Task } from "@/lib/types";

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
  it("rate limits after the limit", async () => {
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await hitRateLimit("login:1.2.3.4", 3, 60));
    expect(results).toEqual([true, true, true, false]);
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
