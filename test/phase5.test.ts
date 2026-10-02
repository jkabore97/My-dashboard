import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ sendNotification: vi.fn(async (_sub: { endpoint: string }) => ({})) }));
vi.mock("web-push", () => ({ default: { setVapidDetails: () => {}, sendNotification: mocks.sendNotification } }));

import { canSee, canSeeTask, eventSection, inBusiness, isFullOwner, parseBusinessList, ROLE_SECTIONS, taskSection, type Access } from "@/lib/access";
import { scopeFor, type Scopable } from "@/lib/scope";
import { summarizeUptime } from "@/lib/portal";
import { accessFor, businessDenied, isAllowed } from "@/lib/server/auth";
import { getDb, pgliteDb, useDb } from "@/lib/server/db";
import { acceptInvite, hashPassword, inviteByToken, inviteMember, memberPasswordHash, removeMember, setMemberDisabled, verifyPassword } from "@/lib/server/store/team";
import { createPortal, portalByToken, revokePortal } from "@/lib/server/store/portals";
import { clientPage, PORTAL_VIEWS_PER_MINUTE } from "@/lib/server/portal";
import { addManualTask, getTask, listActivity, recordActivity, setTaskAssignee } from "@/lib/server/store/tasks";
import { runAlerts } from "@/lib/server/alerts/run";
import { people } from "@/lib/server/people";

afterEach(() => {
  vi.unstubAllEnvs();
});

const dev = (businesses: string[] | null = ["Kaj Store"]): Access => ({ role: "developer", businesses });

// ─── Roles and sections ──────────────────────────────────────────────────────

describe("roles", () => {
  it("gives each role its sections, and only owners the team, platforms and settings management", () => {
    expect(canSee({ role: "owner", businesses: null }, "team")).toBe(true);
    for (const r of ["developer", "assistant", "accountant"] as const) {
      expect(canSee({ role: r, businesses: null }, "team")).toBe(false);
      expect(canSee({ role: r, businesses: null }, "platforms")).toBe(false);
      expect(canSee({ role: r, businesses: null }, "tasks")).toBe(true);
    }
    expect(canSee(dev(), "money")).toBe(false);
    expect(canSee(dev(), "hosting")).toBe(true);
    expect(canSee({ role: "accountant", businesses: null }, "money")).toBe(true);
    expect(canSee({ role: "accountant", businesses: null }, "inbox")).toBe(false);
    expect(canSee({ role: "assistant", businesses: null }, "inbox")).toBe(true);
    expect(ROLE_SECTIONS.owner).toContain("cameras");
  });

  it("treats only an owner with every business as a full owner", () => {
    expect(isFullOwner({ role: "owner", businesses: null })).toBe(true);
    expect(isFullOwner({ role: "owner", businesses: ["Kaj Store"] })).toBe(false);
    expect(isFullOwner(dev(null))).toBe(false);
  });

  it("hides untagged rows from people limited to some businesses", () => {
    expect(inBusiness(dev(), "Kaj Store")).toBe(true);
    expect(inBusiness(dev(), "Kaj Consulting")).toBe(false);
    expect(inBusiness(dev(), null)).toBe(false);
    expect(inBusiness(dev(null), null)).toBe(true);
  });

  it("maps tasks and events to sections", () => {
    expect(taskSection("vercel/deploy-failed:prj_1")).toBe("hosting");
    expect(taskSection("stripe/dispute:dp_1")).toBe("money");
    expect(taskSection("gmail/kaj%40x.com/1")).toBe("inbox");
    expect(taskSection("stripe-dispute:dp_1")).toBe("money");
    expect(taskSection("github-ci:kaj/site:CI:main")).toBe("repos");
    expect(taskSection("hikvision:nvr:videoloss:1")).toBe("cameras");
    expect(taskSection("solar/home:offline")).toBe("solar");
    expect(taskSection(null)).toBe("tasks");
    expect(taskSection("mystery:1")).toBe("tasks");
    expect(eventSection("Email · Kaj")).toBe("inbox");
    expect(eventSection("Stripe")).toBe("money");
    expect(eventSection("GitHub security")).toBe("security");
    expect(eventSection("Website monitor")).toBe("websites");
  });

  it("shows a task when it's yours, or its section and business are", () => {
    const stripeTask = { business: "Kaj Store", sourceKey: "stripe/dispute:1", assignee: null };
    expect(canSeeTask(dev(), "dev@x.com", stripeTask)).toBe(false);
    expect(canSeeTask(dev(), "dev@x.com", { ...stripeTask, assignee: "dev@x.com" })).toBe(true);
    expect(canSeeTask(dev(), "dev@x.com", { business: "Kaj Store", sourceKey: "vercel/deploy-failed:1" })).toBe(true);
    expect(canSeeTask(dev(), "dev@x.com", { business: "Kaj Consulting", sourceKey: "vercel/deploy-failed:1" })).toBe(false);
    expect(canSeeTask(dev(), "dev@x.com", { business: null, sourceKey: null })).toBe(false);
  });

  it("parses business lists and refuses records from other businesses", () => {
    expect(parseBusinessList([" B ", "A", "", "A"])).toEqual(["A", "B"]);
    expect(parseBusinessList(["", " "])).toBeNull();
    expect(businessDenied(dev(), "Kaj Store")).toBeNull();
    expect(businessDenied(dev(), "Kaj Consulting")).toMatch(/Kaj Store/);
    expect(businessDenied(dev(), null)).toMatch(/Kaj Store/);
    expect(businessDenied(dev(), undefined)).toBeNull(); // record doesn't exist yet
    expect(businessDenied(dev(null), null)).toBeNull();
  });

  it("gives environment owners full access whatever their row says", () => {
    vi.stubEnv("ALLOWED_EMAILS", "boss@kaj.com");
    expect(accessFor({ email: "boss@kaj.com", role: "accountant", businesses: ["X"] })).toEqual({ role: "owner", businesses: null });
    expect(accessFor({ email: "amy@kaj.com", role: "accountant", businesses: ["X"] })).toEqual({ role: "accountant", businesses: ["X"] });
  });
});

// ─── Scoping the dashboard ───────────────────────────────────────────────────

function sample(): Scopable {
  const t = (id: string, business: string | undefined, sourceKey: string | null, assignee: string | null = null) => ({ id, title: id, severity: "high" as const, source: "x", createdAt: "2026-10-01T00:00:00Z", business, sourceKey, assignee });
  return {
    repos: [{ id: "1", name: "store", fullName: "kaj/store", url: "", private: true, language: null, defaultBranch: "main", openIssues: 0, openPullRequests: 0, pushedAt: "", business: "Kaj Store" }, { id: "2", name: "site", fullName: "kaj/site", url: "", private: true, language: null, defaultBranch: "main", openIssues: 0, openPullRequests: 0, pushedAt: "", business: "Kaj Consulting" }],
    hosting: [{ id: "h1", name: "store", provider: "vercel", url: null, framework: null, lastDeployState: "ready", lastDeployAt: null, business: "Kaj Store" }, { id: "h2", name: "x", provider: "vercel", url: null, framework: null, lastDeployState: "ready", lastDeployAt: null }],
    databases: [],
    emails: [{ id: "m1", from: "a", subject: "s", snippet: "", receivedAt: "", unread: true, account: "Store", mailbox: "s@x", labels: [], severity: "high", business: "Kaj Store" }],
    websites: [{ id: "w1", domain: "store.com", business: "Kaj Store", status: "up", responseMs: 1, totalUsers: 1, newUsers7d: 0, visitors7d: 0 }, { id: "w2", domain: "kaj.com", business: "Kaj Consulting", status: "up", responseMs: 1, totalUsers: 1, newUsers7d: 0, visitors7d: 0 }],
    stripe: [{ id: "acct", business: "Kaj Store", livemode: true, balance: [], revenue: [], daily: [], mrr: [], activeSubscriptions: 0, pastDueSubscriptions: 0, disputes: [], openInvoices: [], truncated: false }],
    records: { invoices: [], subscriptions: [], deadlines: [], clients: [], deals: [], checklist: { a: "x" } },
    domains: { checks: [{ domain: "store.com" } as never, { domain: "kaj.com" } as never], pending: ["new.store.com", "other.net"] },
    security: { alerts: [{ kind: "dependabot", repo: "kaj/store", number: 1, severity: "high", title: "", url: "", createdAt: "" }, { kind: "dependabot", repo: "kaj/site", number: 2, severity: "high", title: "", url: "", createdAt: "" }], repos: [], github2fa: true, githubLogin: "kaj" },
    calendar: [{ id: "c", title: "Board", start: "", end: "", allDay: false, calendar: "", provider: "google", location: null, meetingUrl: null, url: null }],
    analytics: [{ domain: "store.com", property: null, traffic: null, search: null }, { domain: "kaj.com", property: null, traffic: null, search: null }],
    reviews: [],
    cameras: [{ id: "nvr", label: "Shop", business: "Kaj Store", device: { name: null, model: null, serial: null, firmware: null }, channels: [], disks: [], checkedAt: "" }],
    solar: [],
    notifications: [
      { id: "n1", source: "Vercel", title: "deploy", at: "", severity: "low", business: "Kaj Store" },
      { id: "n2", source: "Stripe", title: "payout", at: "", severity: "high", business: "Kaj Store" },
      { id: "n3", source: "Vercel", title: "deploy", at: "", severity: "low", business: "Kaj Consulting" },
      { id: "n4", source: "GitHub", title: "PR", at: "", severity: "low" },
    ],
    openTasks: [t("deploy", "Kaj Store", "vercel/deploy-failed:h1"), t("dispute", "Kaj Store", "stripe/dispute:1"), t("other", "Kaj Consulting", "vercel/deploy-failed:x"), t("mine", "Kaj Consulting", null, "dev@x.com"), t("manual", undefined, null)],
    derivedTasks: [{ id: "x", title: "x", severity: "low", source: "x", createdAt: "" }],
    platforms: [{ id: "github" }],
    sources: [{ source: "GitHub", mode: "error", error: "token for kaj@x.com expired" }],
    undecryptableConnections: 2,
  };
}

const ctx = { businessForDomain: (d: string) => (d.endsWith("store.com") ? "Kaj Store" : d === "kaj.com" ? "Kaj Consulting" : undefined) };

describe("dashboard scoping", () => {
  it("leaves a full owner's view untouched", () => {
    const d = sample();
    expect(scopeFor(d, { role: "owner", businesses: null }, "boss", ctx)).toBe(d);
  });

  it("cuts a developer for one business down to their sections and business", () => {
    const s = scopeFor(sample(), dev(), "dev@x.com", ctx);
    expect(s.repos.map((r) => r.fullName)).toEqual(["kaj/store"]);
    expect(s.hosting.map((h) => h.id)).toEqual(["h1"]);
    expect(s.websites.map((w) => w.domain)).toEqual(["store.com"]);
    expect(s.emails).toEqual([]);
    expect(s.stripe).toEqual([]);
    expect(s.calendar).toEqual([]);
    expect(s.cameras).toEqual([]);
    expect(s.records.checklist).toEqual({});
    expect(s.domains).toEqual({ checks: [{ domain: "store.com" }], pending: ["new.store.com"] });
    expect(s.security.alerts.map((a) => a.repo)).toEqual(["kaj/store"]);
    expect(s.security.githubLogin).toBeNull();
    expect(s.analytics.map((a) => a.domain)).toEqual(["store.com"]);
    expect(s.notifications.map((n) => n.id)).toEqual(["n1"]);
    expect(s.openTasks.map((t) => t.id)).toEqual(["deploy", "mine"]);
    expect([s.derivedTasks, s.platforms]).toEqual([[], []]);
    expect(s.sources).toEqual([{ source: "GitHub", mode: "error" }]);
    expect(s.undecryptableConnections).toBe(0);
  });

  it("lets an assistant with every business see the inbox, calendar and cameras, but not money", () => {
    const s = scopeFor(sample(), { role: "assistant", businesses: null }, "amy@x.com", ctx);
    expect(s.emails).toHaveLength(1);
    expect(s.calendar).toHaveLength(1);
    expect(s.cameras).toHaveLength(1);
    expect(s.stripe).toEqual([]);
    expect(s.repos).toEqual([]);
    expect(s.openTasks.map((t) => t.id)).toEqual(["mine", "manual"]); // general tasks, not hosting or money
  });

  it("lets an accountant see money for their business only", () => {
    const s = scopeFor(sample(), { role: "accountant", businesses: ["Kaj Consulting"] }, "acc@x.com", ctx);
    expect(s.stripe).toEqual([]);
    expect(s.notifications).toEqual([]);
    expect(scopeFor(sample(), { role: "accountant", businesses: ["Kaj Store"] }, "acc@x.com", ctx).stripe).toHaveLength(1);
  });
});

// ─── Client status page summary ──────────────────────────────────────────────

describe("client uptime summary", () => {
  it("computes uptime and an hourly strip, ignoring unknown checks", () => {
    const now = new Date("2026-10-02T12:00:00Z");
    const at = (hoursAgo: number) => new Date(now.getTime() - hoursAgo * 3_600_000).toISOString();
    const s = summarizeUptime(
      [
        { status: "up", responseMs: 100, at: at(24 * 20) },
        { status: "down", responseMs: null, at: at(24 * 3) },
        { status: "unknown", responseMs: null, at: at(5) },
        { status: "up", responseMs: 120, at: at(2.5) },
        { status: "down", responseMs: null, at: at(2.2) },
        { status: "up", responseMs: 90, at: at(0.5) },
      ],
      now,
    );
    expect(s.status).toBe("up");
    expect(s.responseMs).toBe(90);
    expect(s.uptime7d).toBe(50);
    expect(s.uptime30d).toBe(60);
    expect(s.hours).toHaveLength(24);
    expect(s.hours[21]).toBe(0.5);
    expect(s.hours[23]).toBe(1);
    expect(s.hours[18]).toBeNull(); // only an unknown check
    expect(summarizeUptime([], now)).toMatchObject({ status: "unknown", uptime7d: null, checkedAt: null });
  });
});

// ─── Database-backed ─────────────────────────────────────────────────────────

describe("team, assignments and client pages (PGlite)", () => {
  beforeAll(async () => {
    await useDb(await pgliteDb());
  });
  beforeEach(async () => {
    const db = await getDb();
    await db.exec("truncate tasks, task_activity, invites, client_portals, clients, deals, users, push_subscriptions, notified, snapshots, rate_limits, settings, alert_log, alert_incidents cascade");
    mocks.sendNotification.mockClear();
  });

  it("hashes passwords and rejects wrong ones, including for accounts with no password", async () => {
    const h = await hashPassword("correct horse battery");
    expect(h).toMatch(/^scrypt\$32768\$/);
    expect(await verifyPassword("correct horse battery", h)).toBe(true);
    expect(await verifyPassword("wrong horse battery!", h)).toBe(false);
    expect(await verifyPassword("anything at all", null)).toBe(false);
  });

  it("invites a member who sets a password once, and refuses repeat or duplicate invites", async () => {
    const res = await inviteMember({ email: "amy@kaj.com", name: "Amy", role: "assistant", businesses: ["Kaj Store"], by: "boss" });
    if (!("token" in res)) throw new Error(res.error);
    expect(await inviteByToken(res.token)).toEqual({ email: "amy@kaj.com", name: "Amy", role: "assistant", status: "ok" });
    expect(await isAllowed("amy@kaj.com")).toBe(true);
    expect(await acceptInvite(res.token, await hashPassword("a long password!"))).toBe("amy@kaj.com");
    expect(await acceptInvite(res.token, await hashPassword("another password"))).toBeNull();
    expect((await inviteByToken(res.token))?.status).toBe("used");
    expect(await verifyPassword("a long password!", await memberPasswordHash("amy@kaj.com"))).toBe(true);
    expect(await inviteMember({ email: "amy@kaj.com", name: null, role: "owner", businesses: null, by: "boss" })).toEqual({ error: expect.stringMatching(/already/) });
    expect(await inviteByToken("not-a-token")).toBeNull();
  });

  it("won't turn an existing owner's account into a member", async () => {
    const db = await getDb();
    await db.query("insert into users (email, last_login_at) values ('boss@kaj.com', now())");
    expect(await inviteMember({ email: "boss@kaj.com", name: null, role: "assistant", businesses: null, by: "x" })).toEqual({ error: expect.any(String) });
  });

  it("locks out a disabled member and unassigns a removed one's tasks", async () => {
    const res = await inviteMember({ email: "dev@kaj.com", name: null, role: "developer", businesses: null, by: "boss" });
    if (!("token" in res)) throw new Error(res.error);
    await acceptInvite(res.token, await hashPassword("a long password!"));
    await setMemberDisabled("dev@kaj.com", true);
    expect(await isAllowed("dev@kaj.com")).toBe(false);
    expect(await memberPasswordHash("dev@kaj.com")).toBeNull();
    await setMemberDisabled("dev@kaj.com", false);
    const task = await addManualTask({ title: "Fix it", severity: "high", assignee: "dev@kaj.com" });
    expect((await getTask(task.id))?.assignee).toBe("dev@kaj.com");
    expect(await removeMember("dev@kaj.com")).toBe(true);
    expect((await getTask(task.id))?.assignee).toBeNull();
    expect(await isAllowed("dev@kaj.com")).toBe(false);
  });

  it("records who did what to a task", async () => {
    const db = await getDb();
    await db.query("insert into users (email, role) values ('amy@kaj.com', 'assistant')");
    const task = await addManualTask({ title: "Call the bank", severity: "medium", business: "Kaj Store" });
    await recordActivity(task.id, "boss", "create");
    await setTaskAssignee(task.id, "amy@kaj.com");
    await recordActivity(task.id, "boss", "assign", { assignee: "amy@kaj.com" });
    const log = await listActivity({ taskId: task.id });
    expect(log.map((a) => a.action)).toEqual(["assign", "create"]);
    expect(log[0]).toMatchObject({ actor: "boss", taskTitle: "Call the bank", business: "Kaj Store", assignee: "amy@kaj.com", detail: { assignee: "amy@kaj.com" } });
  });

  it("pushes a critical task only to people who can see it", async () => {
    vi.stubEnv("VAPID_PUBLIC_KEY", "pub");
    vi.stubEnv("VAPID_PRIVATE_KEY", "priv");
    vi.stubEnv("ALLOWED_EMAILS", "boss@kaj.com");
    const db = await getDb();
    await db.query("insert into users (email) values ('boss@kaj.com')");
    await db.query(`insert into users (email, role, businesses) values ('dev@kaj.com', 'developer', '["Kaj Store"]'::jsonb), ('acc@kaj.com', 'accountant', '["Kaj Consulting"]'::jsonb)`);
    for (const who of ["boss@kaj.com", "dev@kaj.com", "acc@kaj.com"]) {
      await db.query("insert into push_subscriptions (endpoint, owner, keys) values ($1, $2, '{\"p256dh\":\"a\",\"auth\":\"b\"}'::jsonb)", [`https://push.example/${who}`, who]);
    }
    expect((await people()).map((p) => p.email).sort()).toEqual(["acc@kaj.com", "boss@kaj.com", "dev@kaj.com"]);
    await db.query("insert into tasks (origin, source_key, title, severity, source, business) values ('event', 'stripe-dispute:dp_1', 'Dispute', 'critical', 'Stripe', 'Kaj Store')");
    expect((await runAlerts()).sent).toBe(1);
    // The developer can't see money; the accountant can't see Kaj Store.
    expect(mocks.sendNotification.mock.calls.map(([sub]) => sub.endpoint)).toEqual(["https://push.example/boss@kaj.com"]);
  });

  it("serves a client's status page by link, without amounts, and stops when it's replaced or turned off", async () => {
    const db = await getDb();
    const [client] = await db.query<{ id: string }>("insert into clients (name, business) values ('Acme', 'Kaj Consulting') returning id");
    await db.query(
      `insert into deals (client_id, title, stage, value_minor, next_step, expected_close, closed_on) values
       ($1, 'Website rebuild', 'proposal', 500000, 'Call Ama about budget', '2026-11-01', null),
       ($1, 'Old pitch', 'lost', 1, null, null, '2026-09-01'),
       ($1, 'Hosting', 'won', 9900, null, null, current_date - 10)`,
      [client.id],
    );
    for (let i = 0; i < 3; i++) await db.query("insert into snapshots (kind, key, data, taken_at) values ('website', 'acme.com', $1::text::jsonb, now() - make_interval(hours => $2))", [JSON.stringify({ status: i === 1 ? "down" : "up", responseMs: 100 }), i]);
    await db.query("insert into snapshots (kind, key, data) values ('website', 'secret.com', '{\"status\":\"up\"}')");

    const { token, portal } = await createPortal({ clientId: client.id, sites: ["acme.com"], showProjects: true, by: "boss" });
    const page = await clientPage(token);
    if (!page || page === "busy") throw new Error("no page");
    expect(page.client).toBe("Acme");
    expect(page.sites.map((s) => s.domain)).toEqual(["acme.com"]);
    expect(page.sites[0].uptime7d).toBeCloseTo(66.7, 1);
    expect(page.projects?.map((p) => [p.title, p.stage])).toEqual([["Hosting", "Underway"], ["Website rebuild", "Proposal sent"]]);
    expect(JSON.stringify(page)).not.toMatch(/500000|budget|Old pitch/);

    const second = await createPortal({ clientId: client.id, sites: [], showProjects: false, by: "boss" });
    expect(await portalByToken(token)).toBeNull();
    expect((await clientPage(second.token)) as object).toMatchObject({ sites: [], projects: null });
    await revokePortal(second.portal.id);
    expect(await clientPage(second.token)).toBeNull();
    expect(portal.id).not.toBe(second.portal.id);
  });

  it("slows down a link opened too often", async () => {
    const db = await getDb();
    const [client] = await db.query<{ id: string }>("insert into clients (name) values ('Busy') returning id");
    const { token } = await createPortal({ clientId: client.id, sites: [], showProjects: true, by: "boss" });
    for (let i = 0; i < PORTAL_VIEWS_PER_MINUTE; i++) expect(await clientPage(token)).not.toBe("busy");
    expect(await clientPage(token)).toBe("busy");
  });

  it("stops serving an archived client's page", async () => {
    const db = await getDb();
    const [client] = await db.query<{ id: string }>("insert into clients (name) values ('Gone') returning id");
    const { token } = await createPortal({ clientId: client.id, sites: [], showProjects: true, by: "boss" });
    await db.query("update clients set archived = true where id = $1", [client.id]);
    expect(await portalByToken(token)).toBeNull();
  });
});

// ─── Microsoft sign-in ───────────────────────────────────────────────────────

import { CONSUMER_TENANT, decodeJwtPayload, msIdentity } from "@/lib/server/ms-identity";
import { googleSignInEnabled, memberPasswordsEnabled, microsoftSignInEnabled, passwordSignInEnabled, isEnvOwner } from "@/lib/server/auth";
import { ensureUser, linkMicrosoft, resetMicrosoftLink } from "@/lib/server/store/users";
import { sessionMethodAllowed } from "@/lib/server/auth";

describe("Microsoft sign-in", () => {
  const TID = "11111111-2222-3333-4444-555555555555";

  it("uses the account name (UPN), never the email claim", () => {
    expect(msIdentity({ tid: TID, oid: "o1", preferred_username: "Jean@KajConsulting.com", email: "ceo@victim.com", name: "Jean" }, { tenant: "common" })).toEqual({ email: "jean@kajconsulting.com", subject: `${TID}:o1`, name: "Jean" });
    expect(msIdentity({ tid: CONSUMER_TENANT, oid: "o2", preferred_username: "me@outlook.com" }, { tenant: "common" })).toMatchObject({ email: "me@outlook.com" });
  });

  it("refuses guest accounts, missing ids and other organizations when a tenant is set", () => {
    expect(msIdentity({ tid: TID, oid: "o", preferred_username: "a_gmail.com#EXT#@kaj.onmicrosoft.com" }, { tenant: "common" })).toEqual({ error: expect.stringMatching(/guest/) });
    expect(msIdentity({ tid: TID, preferred_username: "a@b.com" }, { tenant: "common" })).toHaveProperty("error");
    expect(msIdentity({ tid: TID, oid: "o", preferred_username: "not-an-email" }, { tenant: "common" })).toHaveProperty("error");
    expect(msIdentity({ tid: "99999999-2222-3333-4444-555555555555", oid: "o", preferred_username: "a@b.com" }, { tenant: TID, expectedTid: TID })).toEqual({ error: expect.stringMatching(/different organization/) });
    expect(msIdentity({ tid: TID, oid: "o", preferred_username: "a@b.com" }, { tenant: TID, expectedTid: TID })).toHaveProperty("email", "a@b.com");
  });

  it("decodes an ID token payload", () => {
    const payload = Buffer.from(JSON.stringify({ tid: TID, oid: "x" })).toString("base64url");
    expect(decodeJwtPayload(`h.${payload}.s`)).toEqual({ tid: TID, oid: "x" });
    expect(decodeJwtPayload("garbage")).toBeNull();
  });

  it("can be the only sign-in method", () => {
    vi.stubEnv("MS_CLIENT_ID", "id");
    vi.stubEnv("MS_CLIENT_SECRET", "secret");
    vi.stubEnv("GOOGLE_CLIENT_ID", "gid");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "gsecret");
    vi.stubEnv("DASHBOARD_PASSWORD", "pw");
    vi.stubEnv("SIGN_IN_METHODS", "microsoft");
    vi.stubEnv("ALLOWED_EMAILS", "jean@kajconsulting.com");
    expect([microsoftSignInEnabled(), googleSignInEnabled(), passwordSignInEnabled(), memberPasswordsEnabled()]).toEqual([true, false, false, false]);
    // With passwords off, the password identity is no longer an owner.
    expect(isEnvOwner("owner")).toBe(false);
    expect(isEnvOwner("jean@kajconsulting.com")).toBe(true);
    // Sessions made with a method that's now off stop working, as do unlabelled old ones.
    expect([sessionMethodAllowed("microsoft"), sessionMethodAllowed("password"), sessionMethodAllowed("google"), sessionMethodAllowed(undefined)]).toEqual([true, false, false, false]);
    vi.stubEnv("SIGN_IN_METHODS", "");
    expect([microsoftSignInEnabled(), googleSignInEnabled(), passwordSignInEnabled()]).toEqual([true, true, true]);
    expect(sessionMethodAllowed(undefined)).toBe(true);
  });

  it("pins the first Microsoft account to a user and refuses a different one later", async () => {
    await useDb(await pgliteDb());
    const db = await getDb();
    await db.exec("truncate users cascade");
    await ensureUser("jean@kajconsulting.com");
    await ensureUser("amy@kajconsulting.com");
    const allowed = new Set(["jean@kajconsulting.com", "amy@kajconsulting.com"]);
    const still = async (e: string) => allowed.has(e);
    expect(await linkMicrosoft("jean@kajconsulting.com", "t:o1", still)).toBe(true);
    expect(await linkMicrosoft("jean@kajconsulting.com", "t:o1", still)).toBe(true);
    expect(await linkMicrosoft("jean@kajconsulting.com", "t:o2", still)).toBe(false);
    // The same Microsoft account can't become a second active user…
    expect(await linkMicrosoft("amy@kajconsulting.com", "t:o1", still)).toBe(false);
    // …but an address that can no longer sign in (an owner's old address) gives it up.
    allowed.delete("jean@kajconsulting.com");
    await ensureUser("jean.k@kajconsulting.com");
    expect(await linkMicrosoft("jean.k@kajconsulting.com", "t:o1", still)).toBe(true);
    // A reset lets a recreated account link again.
    expect(await resetMicrosoftLink("jean.k@kajconsulting.com")).toBe(true);
    expect(await linkMicrosoft("jean.k@kajconsulting.com", "t:o3", still)).toBe(true);
  });
});

// ─── Sample data switch ──────────────────────────────────────────────────────

import { emptyLike, fromSource, samplesEnabled } from "@/lib/source";

describe("sample data", () => {
  it("is off in production unless SAMPLE_DATA=on, and unconnected sources come back empty", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(samplesEnabled()).toBe(false);
    const r = await fromSource("X", false, async () => [1], () => [9, 9]);
    expect(r).toMatchObject({ mode: "demo", data: [] });
    const failing = await fromSource("X", true, async () => { throw new Error("boom"); }, () => [9]);
    expect(failing).toMatchObject({ mode: "error", data: [], error: "boom" });
    vi.stubEnv("SAMPLE_DATA", "on");
    expect((await fromSource("X", false, async () => [1], () => [9, 9])).data).toEqual([9, 9]);
  });

  it("empties nested shapes", () => {
    expect(emptyLike({ checks: [1], pending: ["a"] })).toEqual({ checks: [], pending: [] });
    expect(emptyLike({ alerts: [1], github2fa: true, githubLogin: "kaj", nested: { list: [1], n: 2 } })).toEqual({ alerts: [], github2fa: null, githubLogin: null, nested: { list: [], n: null } });
  });
});

import { onSharedHost } from "@/lib/server/config";

describe("shared hosting addresses", () => {
  it("skips domain checks for platform subdomains only", () => {
    expect(onSharedHost("kajshipping.vercel.app")).toBe(true);
    expect(onSharedHost("elim.kaj.workers.dev")).toBe(true);
    expect(onSharedHost("kaj-consulting.com")).toBe(false);
    expect(onSharedHost("notvercel.app")).toBe(false);
  });
});

import { clockZones } from "@/lib/server/clocks";

describe("sidebar clocks", () => {
  it("shows the business zone first, then CLOCKS, skipping bad or duplicate zones", () => {
    vi.stubEnv("BUSINESS_TIMEZONE", "America/New_York");
    vi.stubEnv("CLOCKS", "Ouaga=Africa/Ouagadougou, Mars/Olympus, America/New_York, Asia/Tokyo");
    expect(clockZones()).toEqual([
      { label: "New York", timeZone: "America/New_York" },
      { label: "Ouaga", timeZone: "Africa/Ouagadougou" },
      { label: "Tokyo", timeZone: "Asia/Tokyo" },
    ]);
  });
});

import { inBriefWindow } from "@/lib/server/reports";

describe("morning brief window", () => {
  it("sends from the brief hour for six hours, not overnight", () => {
    expect([6, 7, 8, 12, 13, 23].map((h) => inBriefWindow(h, 7))).toEqual([false, true, true, true, false, false]);
  });
});
