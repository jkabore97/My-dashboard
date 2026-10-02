import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ sendNotification: vi.fn(async (..._a: unknown[]) => ({})) }));
vi.mock("web-push", () => ({ default: { setVapidDetails: () => {}, sendNotification: mocks.sendNotification } }));
vi.mock("next/server", async (orig) => ({ ...(await orig<object>()), after: (fn: () => unknown) => void fn() }));

import { ALWAYS, canConnectPersonal, canSee, canSeeTask, customSections, GRANTABLE, isFullOwner, OWNER_ONLY, PATH_SECTION, roleDefaultSections, ROLE_SECTIONS, sectionsFor, type Access } from "@/lib/access";
import { accessFromForm } from "@/lib/team-form";
import { visibleNav, NAV_GROUPS } from "@/lib/nav";
import { scopeFor, type Scopable } from "@/lib/scope";
import { sectionChoices, sectionLabels } from "@/components/admin/roles";
import { accessFor } from "@/lib/server/auth";
import { getDb, migrate, pgliteDb, useDb, type Db } from "@/lib/server/db";
import { MIGRATIONS } from "@/lib/server/migrations";
import { getMember, inviteByToken, inviteMember, removeMember, updateMember } from "@/lib/server/store/team";
import { getUser } from "@/lib/server/store/users";
import { people } from "@/lib/server/people";
import { AccountTaken, deleteConnection, listConnectionSummaries, listPersonalSummaries, saveConnection } from "@/lib/server/store/connections";
import { collect, deriveTasks, forgetExternalMemory, undecryptableGuards } from "@/lib/aggregate";
import { persist } from "@/lib/server/sync";
import { runAlerts } from "@/lib/server/alerts/run";
import { bellFor, deliveryLog } from "@/lib/server/alerts/store";
import { listEvents } from "@/lib/server/store/events";
import { listTasks, listActivity, recordActivity, upsertEventTask } from "@/lib/server/store/tasks";
import { buildMorningBrief } from "@/lib/server/reports";
import { ownMicrosoftAccount } from "@/lib/server/ms-identity";
import { secretTaskTitle, deriveRiskTasks, type RiskInput } from "@/lib/risk";
import { secretLocation } from "@/lib/connectors/security";
import { handleGithub } from "@/lib/server/webhook-handlers";
import type { EmailMessage } from "@/lib/types";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const form = (entries: [string, string][]) => {
  const f = new FormData();
  for (const [k, v] of entries) f.append(k, v);
  return f;
};

// ─── Per-person sections ─────────────────────────────────────────────────────

describe("per-person sections", () => {
  const brother: Access = { role: "developer", businesses: null, sections: ["inbox", "agenda", "repos", "hosting", "databases"] };

  it("replace the role's sections, keeping the personal pages", () => {
    expect(canSee(brother, "inbox")).toBe(true);
    expect(canSee(brother, "agenda")).toBe(true);
    expect(canSee(brother, "repos")).toBe(true);
    // The developer role has these; the picked list doesn't.
    expect(canSee(brother, "security")).toBe(false);
    expect(canSee(brother, "websites")).toBe(false);
    // Everyone keeps Overview, To-do and their own Settings.
    for (const s of ALWAYS) expect(canSee(brother, s)).toBe(true);
    // Null / missing means the role's own.
    expect(sectionsFor({ role: "developer", businesses: null, sections: null })).toEqual(ROLE_SECTIONS.developer);
    expect(sectionsFor({ role: "developer", businesses: null })).toEqual(ROLE_SECTIONS.developer);
  });

  it("can't grant owner-only sections or owner powers", () => {
    const sneaky = { role: "assistant", businesses: null, sections: ["platforms", "team", "inbox"] } as unknown as Access;
    expect(canSee(sneaky, "platforms")).toBe(false);
    expect(canSee(sneaky, "team")).toBe(false);
    expect(isFullOwner(sneaky)).toBe(false);
    expect(GRANTABLE.some((s) => OWNER_ONLY.includes(s))).toBe(false);
    // From the form: owner-only ticks are dropped, and an owner role never stores a list.
    const a = accessFromForm(form([["role", "developer"], ["allBusinesses", "on"], ["sectionsShown", "1"], ["sections", "team"], ["sections", "platforms"], ["sections", "inbox"]]));
    expect(a).toEqual({ role: "developer", businesses: null, sections: ["inbox"] });
    expect(accessFromForm(form([["role", "owner"], ["allBusinesses", "on"], ["sectionsShown", "1"], ["sections", "inbox"]]))).toEqual({ role: "owner", businesses: null, sections: null });
    // A full owner sees everything whatever a stray list says; a list on an owner role is ignored.
    expect(sectionsFor({ role: "owner", businesses: null, sections: ["inbox"] })).toEqual(ROLE_SECTIONS.owner);
    expect(accessFor({ email: "x@kaj.com", role: "owner", businesses: ["A"], sections: ["inbox"] })).toEqual({ role: "owner", businesses: ["A"], sections: null });
    expect(accessFor({ email: "x@kaj.com", role: "assistant", businesses: null, sections: ["team", "money", "bogus"] })).toEqual({ role: "assistant", businesses: null, sections: ["money"] });
  });

  it("stores nothing when the ticks match the role, so the person follows the role", () => {
    expect(customSections("developer", roleDefaultSections("developer"))).toBeNull();
    expect(customSections("developer", [...roleDefaultSections("developer"), "inbox"])).toEqual(expect.arrayContaining(["inbox", "repos"]));
    expect(accessFromForm(form([["role", "assistant"], ["allBusinesses", "on"]]))).toEqual({ role: "assistant", businesses: null, sections: null }); // no checkboxes on the form
    expect(customSections("accountant", [])).toEqual([]); // nothing ticked: only the personal pages
    expect(sectionsFor({ role: "accountant", businesses: null, sections: [] })).toEqual(["overview", "tasks", "settings"]);
  });

  it("drives the sidebar, the checkbox groups and the labels", () => {
    const allowed = Object.keys(PATH_SECTION).filter((p) => canSee(brother, PATH_SECTION[p]));
    const nav = visibleNav(allowed);
    expect(nav.map((g) => g.id)).toEqual(["core", "build", "admin"]);
    expect(nav.find((g) => g.id === "admin")!.pages.map((p) => p.href)).toEqual(["/settings"]);
    const groups = sectionChoices(NAV_GROUPS, PATH_SECTION);
    expect(groups.find((g) => g.id === "money")!.items.find((i) => i.section === "money")!.label).toBe("Money · Platform spend");
    expect(groups.find((g) => g.id === "admin")!.items.map((i) => i.fixed)).toEqual(["owner", "owner", "always"]);
    expect(sectionLabels(brother, NAV_GROUPS, PATH_SECTION)).toEqual(["Overview", "To-do", "Inbox", "Agenda", "Repos", "Hosting", "Databases", "Settings"]);
  });

  it("grants and denies data, and tasks by section", () => {
    const d = scopeFor(sample(), brother, "bro@kaj.com", ctx);
    expect(d.repos).toHaveLength(1);
    expect(d.emails.map((e) => e.id)).toEqual(["shared", "bro-mail"]); // inbox granted; his own mail too
    expect(d.websites).toEqual([]); // the developer role has websites; the list doesn't
    expect(d.stripe).toEqual([]);
    expect(canSeeTask(brother, "bro@kaj.com", { sourceKey: "outlook/ms%3Ashared%40kaj.com/1", business: "Kaj" })).toBe(true);
    expect(canSeeTask(brother, "bro@kaj.com", { sourceKey: "websites/down:kaj.com", business: "Kaj" })).toBe(false);
    const accountant: Access = { role: "accountant", businesses: null, sections: ["money", "repos"] };
    expect(canSeeTask(accountant, "acc@kaj.com", { sourceKey: "github/prs:kaj/x", business: "Kaj" })).toBe(true);
    expect(canSeeTask(accountant, "acc@kaj.com", { sourceKey: "deadlines/x:2026-10-01", business: "Kaj" })).toBe(false);
    expect(canConnectPersonal(accountant)).toBe(false);
    expect(canConnectPersonal(brother)).toBe(true);
  });
});

// ─── Scoping personal items ──────────────────────────────────────────────────

const mail = (id: string, extra: Partial<EmailMessage> = {}): EmailMessage => ({ id, from: "a <a@b.c>", subject: `Subject ${id}`, snippet: "", receivedAt: "2026-10-01T00:00:00Z", unread: true, account: "x", mailbox: "x", labels: [], severity: "high", ...extra });

function sample(): Scopable {
  return {
    repos: [{ id: "1", name: "app", fullName: "kaj/app", url: "", private: true, language: null, defaultBranch: "main", openIssues: 0, openPullRequests: 0, pushedAt: "", business: "Kaj" }],
    hosting: [],
    databases: [],
    emails: [mail("shared", { business: "Kaj" }), mail("bro-mail", { owner: "bro@kaj.com" }), mail("amy-mail", { owner: "amy@kaj.com" })],
    websites: [{ id: "w", domain: "kaj.com", business: "Kaj", status: "up", responseMs: 1, totalUsers: 1, newUsers7d: 0, visitors7d: 0 }],
    stripe: [{ id: "acct", business: "Kaj", livemode: true, balance: [], revenue: [], daily: [], mrr: [], activeSubscriptions: 0, pastDueSubscriptions: 0, disputes: [], openInvoices: [], truncated: false }],
    records: { invoices: [], subscriptions: [], deadlines: [], clients: [], deals: [], checklist: {} },
    domains: { checks: [], pending: [] },
    security: { alerts: [], repos: [], github2fa: null, githubLogin: null },
    calendar: [
      { id: "board", title: "Board", start: "", end: "", allDay: false, calendar: "Kaj", provider: "microsoft", location: null, meetingUrl: null, url: null },
      { id: "dentist", title: "Dentist", start: "", end: "", allDay: false, calendar: "bro", provider: "microsoft", location: null, meetingUrl: null, url: null, owner: "bro@kaj.com" },
    ],
    analytics: [],
    reviews: [],
    cameras: [],
    solar: [],
    notifications: [
      { id: "n-shared", source: "Outlook · Kaj", title: "shared", at: "", severity: "high", business: "Kaj" },
      { id: "n-bro", source: "Outlook · bro@kaj.com", title: "Subject bro-mail", at: "", severity: "high", owner: "bro@kaj.com" },
    ],
    openTasks: [
      { id: "t-shared", title: "shared", severity: "high", source: "x", createdAt: "", business: "Kaj", sourceKey: "outlook/x/1" },
      { id: "t-bro", title: "Subject bro-mail", severity: "high", source: "x", createdAt: "", sourceKey: "mymail/ms%3Abro%40kaj.com/1", privateTo: "bro@kaj.com", assignee: "boss@kaj.com" },
    ],
    derivedTasks: [{ id: "mymail/x/1", title: "Subject bro-mail", severity: "high", source: "x", createdAt: "", privateTo: "bro@kaj.com" }],
    platforms: [],
    sources: [],
    undecryptableConnections: 0,
    personalProblems: [{ owner: "bro@kaj.com", provider: "microsoft", account: "bro@kaj.com", mailbox: "ms:bro@kaj.com", error: "revoked" }],
  };
}

const ctx = { businessForDomain: () => "Kaj" };
const OWNER: Access = { role: "owner", businesses: null };

describe("personal mail and calendars in the scoped dashboard", () => {
  it("are hidden from the full owner", () => {
    const d = scopeFor(sample(), OWNER, "boss@kaj.com", ctx);
    expect(d.emails.map((e) => e.id)).toEqual(["shared"]);
    expect(d.calendar.map((e) => e.id)).toEqual(["board"]);
    expect(d.notifications.map((n) => n.id)).toEqual(["n-shared"]);
    // Even assigned to the owner, a personal task stays its owner's.
    expect(d.openTasks.map((t) => t.id)).toEqual(["t-shared"]);
    expect(d.derivedTasks).toEqual([]);
    expect(d.personalProblems).toEqual([]);
  });

  it("are hidden from other members, whatever their sections", () => {
    const amy: Access = { role: "assistant", businesses: null };
    const d = scopeFor(sample(), amy, "amy@kaj.com", ctx);
    expect(d.emails.map((e) => e.id)).toEqual(["shared", "amy-mail"]);
    expect(d.calendar.map((e) => e.id)).toEqual(["board"]);
    expect(d.openTasks.map((t) => t.id)).toEqual(["t-shared"]);
  });

  it("are shown to their owner, even outside the owner's businesses", () => {
    const bro: Access = { role: "developer", businesses: ["Other"], sections: ["inbox", "agenda", "repos"] };
    const d = scopeFor(sample(), bro, "bro@kaj.com", ctx);
    expect(d.emails.map((e) => e.id)).toEqual(["bro-mail"]); // shared mail of a business he doesn't have stays hidden
    expect(d.calendar.map((e) => e.id)).toEqual(["board", "dentist"]);
    expect(d.notifications.map((n) => n.id)).toEqual(["n-bro"]);
    expect(d.openTasks.map((t) => t.id)).toEqual(["t-bro"]);
    expect(d.personalProblems).toHaveLength(1);
  });

  it("keep shared mailbox rules as they were (role + business)", () => {
    const scoped: Access = { role: "assistant", businesses: ["Other"] };
    expect(scopeFor(sample(), scoped, "x@kaj.com", ctx).emails).toEqual([]);
    const dev: Access = { role: "developer", businesses: null };
    expect(scopeFor(sample(), dev, "x@kaj.com", ctx).emails).toEqual([]);
    expect(scopeFor(sample(), dev, "x@kaj.com", ctx).calendar).toEqual([]);
  });

  it("derives personal tasks (and reconnect tasks) only for the mailbox owner", () => {
    const tasks = deriveTasks({
      repos: [], hosting: [], databases: [], websites: [], sources: [],
      emails: [mail("m1", { owner: "bro@kaj.com", mailbox: "ms:bro@kaj.com", business: "Kaj" }), mail("m2", { mailbox: "ms:shared@kaj.com", account: "Kaj" })],
      modes: { github: "demo", vercel: "demo", workers: "demo", supabase: "demo", d1: "demo", gmail: "demo", websites: "demo", outlook: "live", mymail: "live" },
      personalProblems: [{ owner: "bro@kaj.com", provider: "microsoft", account: "bro@kaj.com", mailbox: "ms:bro@kaj.com", error: "revoked" }],
    });
    const personal = tasks.filter((t) => t.scope === "mymail");
    expect(personal.map((t) => t.id)).toEqual(["mymail/ms%3Abro%40kaj.com/m1", "mymail/ms%3Abro%40kaj.com/reconnect"]);
    expect(personal.every((t) => t.privateTo === "bro@kaj.com" && !t.business && t.live)).toBe(true);
    expect(tasks.find((t) => t.scope === "outlook")?.privateTo).toBeUndefined();
    // A personal mailbox whose sign-in no longer decrypts keeps its personal tasks, and doesn't freeze the shared ones.
    expect(undecryptableGuards([{ provider: "microsoft", account: "bro@kaj.com", ownerEmail: "bro@kaj.com" }])).toEqual({ unobserved: ["mymail/ms%3Abro%40kaj.com/"], skipScopes: [] });
  });
});

// ─── Microsoft ownership ─────────────────────────────────────────────────────

describe("connecting your own Microsoft account", () => {
  const claims = { tid: "t1", oid: "o1", preferred_username: "Bro@Kaj.com" };
  const opts = { tenant: "common" };
  it("must be the account the person signs in with", () => {
    expect(ownMicrosoftAccount(claims, { email: "bro@kaj.com", msSubject: "t1:o1" }, opts)).toEqual({ subject: "t1:o1", email: "bro@kaj.com" });
    expect(ownMicrosoftAccount(claims, { email: "bro@kaj.com", msSubject: "t1:other" }, opts)).toHaveProperty("error");
  });
  it("or, without Microsoft sign-in, the account named like their address", () => {
    expect(ownMicrosoftAccount(claims, { email: "bro@kaj.com", msSubject: null }, opts)).toEqual({ subject: "t1:o1", email: "bro@kaj.com" });
    expect(ownMicrosoftAccount({ ...claims, preferred_username: "boss@kaj.com" }, { email: "bro@kaj.com", msSubject: null }, opts)).toHaveProperty("error");
  });
});

// ─── With a database ─────────────────────────────────────────────────────────

const NO_QUIET = '{"quietFrom":0,"quietTo":0,"timeZone":"UTC"}';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("personal mailboxes end to end (PGlite)", () => {
  beforeAll(async () => {
    await useDb(await pgliteDb());
  });
  beforeEach(async () => {
    vi.stubEnv("VAPID_PUBLIC_KEY", "pub");
    vi.stubEnv("VAPID_PRIVATE_KEY", "priv");
    vi.stubEnv("ALLOWED_EMAILS", "boss@kaj.com");
    vi.stubEnv("BUSINESS_TIMEZONE", "UTC");
    vi.stubEnv("MS_CLIENT_ID", "id");
    vi.stubEnv("MS_CLIENT_SECRET", "secret");
    const db = await getDb();
    await db.exec("truncate tasks, task_activity, events, connections, users, invites, push_subscriptions, settings, alert_log, alert_incidents, audit_log cascade");
    await db.query(`insert into users (email, notify_prefs) values ('boss@kaj.com', $1::text::jsonb)`, [NO_QUIET]);
    await db.query(
      `insert into users (email, role, businesses, sections, notify_prefs) values
        ('bro@kaj.com', 'developer', null, '["inbox","agenda","repos","hosting","databases"]'::jsonb, $1::text::jsonb),
        ('amy@kaj.com', 'assistant', null, null, $1::text::jsonb)`,
      [NO_QUIET],
    );
    for (const who of ["boss@kaj.com", "bro@kaj.com", "amy@kaj.com"]) {
      await db.query("insert into push_subscriptions (endpoint, owner, keys) values ($1, $2, '{\"p256dh\":\"a\",\"auth\":\"b\"}'::jsonb)", [`https://push.example/${who}`, who]);
    }
    mocks.sendNotification.mockReset();
    mocks.sendNotification.mockImplementation(async () => ({}));
    forgetExternalMemory();
  });

  function graphStub(account: string) {
    vi.stubGlobal("fetch", async (input: string | URL) => {
      const url = String(input);
      if (url.startsWith("https://login.microsoftonline.com/")) return json({ access_token: `at-${account}`, expires_in: 3600 });
      if (url.includes("/me/mailFolders/inbox/messages")) {
        return json({ value: [{ id: "AAA1", subject: "Payment failed on your card", bodyPreview: "Action required", receivedDateTime: new Date().toISOString(), isRead: false, importance: "normal", webLink: "https://outlook.office.com/x", from: { emailAddress: { name: "Bank", address: "alerts@bank.example" } } }] });
      }
      if (url.includes("/me/calendarView")) {
        const start = new Date(Date.now() + 3_600_000).toISOString().slice(0, 19);
        return json({ value: [{ id: "EV1", subject: "Dentist", isAllDay: false, webLink: "https://outlook.office.com/e", start: { dateTime: start, timeZone: "UTC" }, end: { dateTime: start, timeZone: "UTC" } }] });
      }
      return json({ message: "not stubbed" }, 404);
    });
  }

  it("keeps a member's mail, events, tasks and alerts to that member alone", async () => {
    await saveConnection({ provider: "microsoft", account: "bro@kaj.com", secret: { refreshToken: "rt" }, meta: { personal: true }, ownerEmail: "bro@kaj.com" });
    graphStub("bro@kaj.com");
    const c = await collect();
    expect(c.modes.mymail).toBe("live");
    const msg = c.emails.find((e) => e.subject === "Payment failed on your card")!;
    expect(msg).toMatchObject({ owner: "bro@kaj.com", severity: "critical" });
    expect(msg.business).toBeUndefined();
    expect(c.calendar.find((e) => e.title === "Dentist")?.owner).toBe("bro@kaj.com");
    // Nothing personal leaks into the shared connector errors.
    expect(c.sources.some((s) => s.source === "My mail")).toBe(false);

    // The scoped views.
    const boss = { ...OWNER };
    const bro = accessFor((await getUser("bro@kaj.com"))!);
    const amy = accessFor((await getUser("amy@kaj.com"))!);
    const cx = { businessForDomain: () => undefined };
    const view = (a: Access, email: string) => scopeFor({ ...c, openTasks: [], notifications: c.notifications, platforms: [], sources: c.sources }, a, email, cx);
    expect(view(boss, "boss@kaj.com").emails.some((e) => e.owner)).toBe(false);
    expect(view(boss, "boss@kaj.com").calendar.some((e) => e.owner)).toBe(false);
    expect(view(boss, "boss@kaj.com").notifications.some((n) => n.owner)).toBe(false);
    expect(view(amy, "amy@kaj.com").emails.some((e) => e.owner)).toBe(false);
    expect(view(bro, "bro@kaj.com").emails.map((e) => e.subject)).toContain("Payment failed on your card");
    expect(view(bro, "bro@kaj.com").calendar.map((e) => e.title)).toContain("Dentist");

    // Persisted: a private task and a private event.
    await persist(c, { force: true, alerts: false });
    const open = await listTasks("open");
    const t = open.find((x) => x.title === "Payment failed on your card")!;
    expect(t).toMatchObject({ privateTo: "bro@kaj.com", severity: "critical" });
    expect(t.sourceKey).toMatch(/^mymail\//);
    expect(canSeeTask(boss, "boss@kaj.com", t)).toBe(false);
    expect(canSeeTask(amy, "amy@kaj.com", t)).toBe(false);
    expect(canSeeTask(bro, "bro@kaj.com", t)).toBe(true);
    const events = await listEvents();
    expect(events.find((e) => e.title === "Payment failed on your card")?.owner).toBe("bro@kaj.com");

    // Alerts: only the mailbox owner.
    await runAlerts();
    // (Other sources may be configured in this environment; only the personal task matters here.)
    const about = mocks.sendNotification.mock.calls.filter(([, body]) => JSON.parse(body as string).tag === `task-${t.id}`);
    expect(about.map(([sub]) => (sub as { endpoint: string }).endpoint)).toEqual(["https://push.example/bro@kaj.com"]);
    // Sender-safe email wording, as for shared mail.
    expect(JSON.parse(about[0][1] as string)).toMatchObject({ title: "Critical email", body: "Bank <alerts@bank.example>: Payment failed on your card", appBadge: 1 });
    expect(mocks.sendNotification.mock.calls.some(([sub, body]) => (sub as { endpoint: string }).endpoint.endsWith("boss@kaj.com") && String(body).includes("Payment"))).toBe(false);
    expect((await bellFor({ email: "boss@kaj.com", ...boss })).items.some((i) => i.taskId === t.id)).toBe(false);
    expect((await bellFor({ email: "bro@kaj.com", ...bro })).urgent).toBe(1);
    // The owner's view of everyone's delivery log leaves it out; his own log has it.
    expect((await deliveryLog({ email: "boss@kaj.com", ...boss }, true)).some((r) => r.taskId === t.id)).toBe(false);
    expect((await deliveryLog({ email: "bro@kaj.com", ...bro }, false)).map((r) => r.userEmail)).toEqual(["bro@kaj.com"]);

    // The owner's morning brief has neither the personal task nor the dentist.
    const brief = await buildMorningBrief(c);
    expect(brief.text).not.toContain("Payment failed");
    expect(brief.text).not.toContain("Dentist");

    // Task activity on it isn't shown to the owner (the Team page filters on privateTo).
    await recordActivity(t.id, "bro@kaj.com", "done");
    expect((await listActivity()).find((a) => a.taskId === t.id)?.privateTo).toBe("bro@kaj.com");

    // The owner sees that a personal mailbox exists, never in the shared list.
    expect(await listConnectionSummaries()).toEqual([]);
    expect((await listPersonalSummaries()).map((p) => [p.ownerEmail, p.provider])).toEqual([["bro@kaj.com", "microsoft"]]);
  });

  it("keeps an account to one owner, and only its owner (or the dashboard owner) disconnects it", async () => {
    await saveConnection({ provider: "microsoft", account: "bro@kaj.com", secret: { refreshToken: "rt" }, ownerEmail: "bro@kaj.com" });
    // Someone else, or the shared Platforms page, can't take it over.
    await expect(saveConnection({ provider: "microsoft", account: "bro@kaj.com", secret: { refreshToken: "x" }, ownerEmail: "amy@kaj.com" })).rejects.toBeInstanceOf(AccountTaken);
    await expect(saveConnection({ provider: "microsoft", account: "bro@kaj.com", secret: { refreshToken: "x" } })).rejects.toBeInstanceOf(AccountTaken);
    // Reconnecting your own works.
    expect(await saveConnection({ provider: "microsoft", account: "bro@kaj.com", secret: { refreshToken: "new" }, ownerEmail: "bro@kaj.com" })).toEqual([]);
    const [p] = await listPersonalSummaries("bro@kaj.com");
    expect(await deleteConnection(p.id)).toBeNull(); // the shared-connection path
    expect(await deleteConnection(p.id, { ownerEmail: "amy@kaj.com" })).toBeNull();
    expect(await deleteConnection(p.id, { ownerEmail: "bro@kaj.com" })).toMatchObject({ account: "bro@kaj.com" });
    // A personal one never replaces the shared single-account connection either.
    await saveConnection({ provider: "github", account: "kaj", secret: { token: "t" } });
    expect((await listConnectionSummaries()).map((x) => x.account)).toEqual(["kaj"]);
  });

  it("removing a member removes their mailbox and its tasks", async () => {
    await saveConnection({ provider: "microsoft", account: "bro@kaj.com", secret: { refreshToken: "rt" }, ownerEmail: "bro@kaj.com" });
    graphStub("bro@kaj.com");
    await persist(await collect(), { force: true, alerts: false });
    expect((await listTasks("open")).some((t) => t.privateTo)).toBe(true);
    expect(await removeMember("bro@kaj.com")).toBe(true);
    expect(await listPersonalSummaries()).toEqual([]);
    expect((await listTasks("open")).some((t) => t.privateTo)).toBe(false);
    expect((await listEvents()).some((e) => e.owner)).toBe(false);
  });

  it("routes shared alerts by the picked sections", async () => {
    // Bro (developer preset, custom pages without Security) and amy (assistant).
    await upsertEventTask("github-ci:kaj/app:ci:main", { title: "CI failed", severity: "critical", source: "GitHub", createdAt: new Date().toISOString() });
    await upsertEventTask("github-secret:kaj/app:1", { title: "Leaked key", severity: "critical", source: "GitHub security", createdAt: new Date().toISOString() });
    await runAlerts();
    const by = new Map<string, string[]>();
    for (const [sub, body] of mocks.sendNotification.mock.calls) {
      const t = JSON.parse(body as string).title as string;
      by.set(t, [...(by.get(t) ?? []), (sub as { endpoint: string }).endpoint.replace("https://push.example/", "")].sort());
    }
    expect(by.get("Critical: CI failed")).toEqual(["boss@kaj.com", "bro@kaj.com"]);
    expect(by.get("Critical: Leaked key")).toEqual(["boss@kaj.com"]); // security isn't in bro's pages
  });

  it("stores picked sections on invite and edit; changes apply on the next request without signing out", async () => {
    const res = await inviteMember({ email: "new@kaj.com", name: "New", role: "developer", businesses: null, sections: ["inbox", "repos", "team" as never], by: "boss@kaj.com" });
    if (!("token" in res)) throw new Error(res.error);
    expect(await inviteByToken(res.token)).toMatchObject({ role: "developer", sections: ["inbox", "repos"] });
    expect((await getMember("new@kaj.com"))?.sections).toEqual(["inbox", "repos"]);
    const before = (await getUser("bro@kaj.com"))!;
    expect(canSee(accessFor(before), "agenda")).toBe(true);
    await updateMember("bro@kaj.com", { name: "Bro", role: "developer", businesses: null, sections: ["repos"] });
    const after = (await getUser("bro@kaj.com"))!;
    expect(canSee(accessFor(after), "agenda")).toBe(false);
    expect(after.session_version).toBe(before.session_version); // still signed in; access is read per request
    await updateMember("bro@kaj.com", { name: "Bro", role: "developer", businesses: null, sections: null });
    expect(accessFor((await getUser("bro@kaj.com"))!).sections).toBeNull();
    expect((await people()).find((p) => p.email === "new@kaj.com")?.sections).toEqual(["inbox", "repos"]);
    expect((await people()).find((p) => p.email === "amy@kaj.com")?.sections).toBeNull();
  });
});

// ─── Migration on an existing database ───────────────────────────────────────

describe("migration 11", () => {
  it("applies on a database that already has data", async () => {
    const db: Db = await pgliteDb();
    await db.exec("create table schema_migrations (version integer primary key, name text not null, applied_at timestamptz not null default now())");
    for (const m of MIGRATIONS.filter((x) => x.version <= 10)) {
      await db.exec(m.sql);
      await db.query("insert into schema_migrations (version, name) values ($1, $2)", [m.version, m.name]);
    }
    await db.query("insert into users (email, role, businesses) values ('amy@kaj.com', 'assistant', '[\"Kaj\"]'::jsonb)");
    await db.query("insert into connections (provider, account, secret) values ('microsoft', 'boss@kaj.com', 'x')");
    await db.query("insert into tasks (origin, source_key, title, severity, source) values ('derived', 'outlook/a/1', 'Hi', 'high', 'Email')");
    await migrate(db);
    const [u] = await db.query<{ sections: unknown; role: string }>("select sections, role from users where email = 'amy@kaj.com'");
    expect(u).toEqual({ sections: null, role: "assistant" });
    const [c] = await db.query<{ owner_email: string | null }>("select owner_email from connections");
    expect(c.owner_email).toBeNull();
    const [t] = await db.query<{ private_to: string | null }>("select private_to from tasks");
    expect(t.private_to).toBeNull();
    const [l] = await db.query<{ n: number }>("select count(*)::int as n from information_schema.columns where table_name = 'alert_log' and column_name = 'private'");
    expect(Number(l.n)).toBe(1);
    expect((await db.query<{ version: number }>("select version from schema_migrations order by version")).map((r) => Number(r.version)).at(-1)).toBe(11);
    await migrate(db); // idempotent
  });
});

// ─── Leaked-secret task titles ───────────────────────────────────────────────

describe("leaked-secret tasks", () => {
  it("tell several alerts of one type apart", () => {
    const base: RiskInput = {
      today: "2026-10-02",
      stripe: [],
      records: { invoices: [], subscriptions: [], deadlines: [], checklist: {}, clients: [], deals: [] },
      domains: { checks: [], pending: [] },
      security: {
        alerts: [1, 2, 3].map((n) => ({ kind: "secret" as const, repo: "jkabore97/elim", number: n, severity: "critical" as const, title: "Leaked Google API Key", url: `u${n}`, createdAt: "", ...(n < 3 ? { location: `src/config/firebase${n}.js:${n * 10}` } : {}) })),
        repos: [{ repo: "jkabore97/elim", dependabot: "on", secretScanning: "on" }],
        github2fa: null,
        githubLogin: null,
      },
      sites: [],
      repos: ["jkabore97/elim"],
      modes: { stripe: "live", invoices: "live", subscriptions: "live", deadlines: "live", checklist: "live", domains: "live", security: "live", gmail: "demo", vercel: "live", workers: "demo", supabase: "demo" },
      partial: { stripe: [], security: [] },
    };
    const titles = deriveRiskTasks(base).tasks.filter((t) => t.id.includes("/secret:")).map((t) => t.title);
    expect(titles).toEqual([
      "Rotate the Google API Key leaked in jkabore97/elim (alert #1, config/firebase1.js)",
      "Rotate the Google API Key leaked in jkabore97/elim (alert #2, config/firebase2.js)",
      "Rotate the Google API Key leaked in jkabore97/elim (alert #3)",
    ]);
    expect(new Set(titles).size).toBe(3);
    expect(secretLocation({ first_location_detected: { path: "a/b.ts", start_line: 4 } })).toBe("a/b.ts:4");
    expect(secretLocation({ first_location_detected: null })).toBeUndefined();
    expect(secretTaskTitle({ repo: "r/x", title: "Leaked token", number: 9 })).toBe("Rotate the token leaked in r/x (alert #9)");
    const hook = handleGithub("secret_scanning_alert", "d1", { action: "created", repository: { full_name: "jkabore97/elim" }, alert: { number: 7, html_url: "u", secret_type_display_name: "Google API Key", first_location_detected: { path: "web/app.js", start_line: 3 } } });
    expect(hook.openTasks[0].title).toBe("Rotate the Google API Key leaked in jkabore97/elim (alert #7, web/app.js)");
  });
});
