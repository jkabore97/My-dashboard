import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { latestDomainCheck, refreshDomainChecks, type Lookups } from "@/lib/server/domains";
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
import { addInvoice, completeDeadline, reopenDeadline, listDeadlines, listInvoices, listSubscriptions, saveDeadline, saveSubscription, setInvoiceStatus } from "@/lib/server/store/ledger";
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
  await db.exec("truncate tasks, events, settings, connections, users, rate_limits, audit_log, snapshots, invoices, subscriptions, deadlines");
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

describe("money and deadlines records", () => {
  it("round-trips dates and large amounts exactly on every driver", async () => {
    await addInvoice({ business: "Kaj", client: "ClientCo", number: "K-1", amountMinor: 9_007_199_254_740, currency: "xof", issuedOn: "2026-09-01", dueOn: "2026-09-30", notes: null });
    const [inv] = await listInvoices({ status: "open" });
    expect(inv).toMatchObject({ amountMinor: 9_007_199_254_740, dueOn: "2026-09-30", issuedOn: "2026-09-01", status: "open", paidOn: null });
    await setInvoiceStatus(inv.id, "paid", "2026-10-02");
    expect(await listInvoices({ status: "open" })).toHaveLength(0);
    expect((await listInvoices({ paidSince: "2026-07-01" }))[0]).toMatchObject({ status: "paid", paidOn: "2026-10-02" });
    expect(await listInvoices({ paidSince: "2026-10-03" })).toHaveLength(0);
  });

  it("saves and edits subscriptions", async () => {
    const s = await saveSubscription({ business: null, vendor: "Vercel", plan: "Pro", amountMinor: 2000, currency: "usd", interval: "month", nextRenewal: "2026-10-05", autoRenew: true, url: null, notes: null });
    await saveSubscription({ id: s!.id, business: "Kaj", vendor: "Vercel", plan: "Pro", amountMinor: 4000, currency: "usd", interval: "month", nextRenewal: "2026-10-05", autoRenew: false, url: null, notes: null });
    const [after] = await listSubscriptions();
    expect(after).toMatchObject({ business: "Kaj", amountMinor: 4000, autoRenew: false, nextRenewal: "2026-10-05", active: true });
    expect(await saveSubscription({ id: "00000000-0000-0000-0000-000000000000", business: null, vendor: "x", plan: null, amountMinor: 1, currency: "usd", interval: "month", nextRenewal: null, autoRenew: true, url: null, notes: null })).toBeNull();
  });

  it("rolls recurring deadlines forward once, even on a double click", async () => {
    const q = await saveDeadline({ business: null, title: "Estimated tax", category: "tax", dueOn: "2026-10-15", recurrence: "quarterly", remindDays: 14, notes: null, url: null });
    const once = await saveDeadline({ business: null, title: "Annual report", category: "filing", dueOn: "2026-10-20", recurrence: "none", remindDays: 14, notes: null, url: null });
    expect((await completeDeadline(q!.id, "2026-10-02", "2026-10-15"))?.next).toBe("2027-01-15");
    expect(await completeDeadline(q!.id, "2026-10-02", "2026-10-15")).toBeNull(); // stale second click
    await completeDeadline(once!.id, "2026-10-02");
    const all = await listDeadlines(true);
    expect(all.find((d) => d.id === q!.id)).toMatchObject({ dueOn: "2027-01-15", completedOn: null });
    expect(all.find((d) => d.id === once!.id)).toMatchObject({ completedOn: "2026-10-02" });
    expect((await listDeadlines()).map((d) => d.title)).toEqual(["Estimated tax"]);
  });
});

describe("deadline anchors and undo", () => {
  const dl = (dueOn: string, recurrence: "monthly" | "quarterly") => saveDeadline({ business: null, title: `${recurrence} ${dueOn}`, category: "tax", dueOn, recurrence, remindDays: 14, notes: null, url: null });
  const stepAll = async (id: string, n: number) => {
    const seen: string[] = [];
    for (let i = 0; i < n; i++) {
      const cur = (await listDeadlines()).find((x) => x.id === id)!;
      seen.push((await completeDeadline(id, "2026-01-01", cur.dueOn))!.next!);
    }
    return seen;
  };
  it("keeps the original month-end day when repeating", async () => {
    const q = await dl("2026-03-31", "quarterly");
    expect(await stepAll(q!.id, 4)).toEqual(["2026-06-30", "2026-09-30", "2026-12-31", "2027-03-31"]);
    const m = await dl("2026-01-31", "monthly");
    expect(await stepAll(m!.id, 3)).toEqual(["2026-02-28", "2026-03-31", "2026-04-30"]);
  });
  it("keeps the anchor through an edit that doesn't move the date", async () => {
    const q = await dl("2026-03-31", "quarterly");
    await stepAll(q!.id, 1); // now Jun 30
    await saveDeadline({ id: q!.id, business: "Kaj", title: "renamed", category: "tax", dueOn: "2026-06-30", recurrence: "quarterly", remindDays: 7, notes: null, url: null });
    expect(await stepAll(q!.id, 2)).toEqual(["2026-09-30", "2026-12-31"]);
  });
  it("falls back to the current day for rows without an anchor", async () => {
    const q = await dl("2026-03-31", "quarterly");
    const db = await getDb();
    await db.query("update deadlines set anchor_day = null");
    expect(await stepAll(q!.id, 1)).toEqual(["2026-06-30"]);
  });
  it("undoes a completed one-off deadline and lets its task come back", async () => {
    const once = await saveDeadline({ business: null, title: "Annual report", category: "filing", dueOn: "2026-10-20", recurrence: "none", remindDays: 14, notes: null, url: null });
    const key = `deadlines/${once!.id}:2026-10-20`;
    await reconcileDerived([t(key)], ["deadlines"]);
    const [task] = await listTasks("open");
    await completeTask(task.id);
    await completeDeadline(once!.id, "2026-10-02");
    expect(await reopenDeadline(once!.id)).toEqual({ title: "Annual report" });
    expect(await reopenDeadline(once!.id)).toBeNull();
    expect((await listDeadlines()).map((x) => x.title)).toEqual(["Annual report"]);
    await reconcileDerived([t(key)], ["deadlines"]); // still due soon: the task reopens
    expect((await listTasks("open")).map((x) => x.title)).toEqual([key]);
  });
});

describe("domain check scheduling", () => {
  const lookups = (opts: { delayMs?: number; failFor?: string; active?: { now: number; max: number } } = {}): Lookups => ({
    fetchJson: async () => ({ Status: 3 }),
    certificate: (host) => {
      if (host === opts.failFor) throw new Error("boom"); // thrown synchronously: the whole check fails
      return (async () => {
        if (opts.active) opts.active.max = Math.max(opts.active.max, ++opts.active.now);
        await new Promise((r) => setTimeout(r, opts.delayMs ?? 0));
        if (opts.active) opts.active.now--;
        return { expiresOn: "2027-01-01", issuer: null, valid: true, problem: null };
      })();
    },
  });
  const domains = Array.from({ length: 10 }, (_, i) => `d${i}.example.com`);

  it("checks a few at a time and stops starting new checks after the deadline", async () => {
    const active = { now: 0, max: 0 };
    const n = await refreshDomainChecks(domains, [], { lookups: lookups({ delayMs: 200, active }), deadline: Date.now() + 250, concurrency: 4 });
    expect(active.max).toBe(4);
    expect(n).toBeGreaterThanOrEqual(4);
    expect(n).toBeLessThan(10);
    // The rest weren't claimed, so the next run picks them up.
    expect(await refreshDomainChecks(domains, [], { lookups: lookups() })).toBe(10 - n);
  });

  it("releases the claim when a check couldn't be stored", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await refreshDomainChecks(["a.example.com", "b.example.com"], [], { lookups: lookups({ failFor: "b.example.com" }) })).toBe(1);
    quiet.mockRestore();
    expect(await latestDomainCheck("b.example.com")).toBeNull();
    expect(await refreshDomainChecks(["a.example.com", "b.example.com"], [], { lookups: lookups() })).toBe(1); // only b is due again
    expect(await latestDomainCheck("b.example.com")).not.toBeNull();
  });
});

describe("webhook and polling duplicates", () => {
  it("drops a polled task when the webhook already reported the same problem", async () => {
    await upsertEventTask("stripe-dispute:dp_1", { title: "webhook dispute", severity: "critical", source: "Stripe", createdAt: new Date().toISOString() });
    const polled = (id: string, alias: string) => ({ ...t(id), live: true, scope: "stripe", alias });
    const c = { modes: { stripe: "live" }, derivedTasks: [polled("stripe/acct/dispute:dp_1", "stripe-dispute:dp_1"), polled("stripe/acct/dispute:dp_2", "stripe-dispute:dp_2")], notifications: [], websites: [], unobserved: [], skipScopes: [], credentialsKnown: true } as unknown as Collected;
    await persist(c, { force: true });
    expect((await listTasks("open")).map((x) => x.title).sort()).toEqual(["stripe/acct/dispute:dp_2", "webhook dispute"]);
  });

  const polledInvoice = () =>
    ({ modes: { stripe: "live" }, derivedTasks: [{ ...t("stripe/acct/invoice:in_1"), live: true, scope: "stripe", alias: "stripe-invoice:in_1" }], notifications: [], websites: [], unobserved: [], skipScopes: [], credentialsKnown: true }) as unknown as Collected;
  const webhookTask = async () => {
    await upsertEventTask("stripe-invoice:in_1", { title: "payment failed", severity: "high", source: "Stripe", createdAt: new Date().toISOString() });
    return (await listTasks("open"))[0];
  };

  it("keeps the polled task hidden once the user closed the webhook task", async () => {
    await completeTask((await webhookTask()).id);
    await persist(polledInvoice(), { force: true });
    expect(await listTasks("open")).toHaveLength(0);
  });

  it("keeps it hidden just after the platform resolved it, while polled data may be stale", async () => {
    await webhookTask();
    await resolveEventTask("stripe-invoice:in_1");
    await persist(polledInvoice(), { force: true });
    expect(await listTasks("open")).toHaveLength(0);
  });

  it("brings the polled task back when the platform resolved it over 5 minutes ago but the problem remains", async () => {
    await webhookTask();
    await resolveEventTask("stripe-invoice:in_1");
    const db = await getDb();
    await db.query("update tasks set resolved_at = now() - interval '6 minutes' where source_key = 'stripe-invoice:in_1'");
    await persist(polledInvoice(), { force: true });
    expect((await listTasks("open")).map((x) => x.title)).toEqual(["stripe/acct/invoice:in_1"]);
  });
});
