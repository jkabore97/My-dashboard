import { describe, expect, it } from "vitest";
import { deriveTasks, mergeSources, undecryptableGuards, unobservedKeys } from "@/lib/aggregate";
import { classifyEmail } from "@/lib/connectors/gmail";
import { parseBusinessRules, parseSites, businessFor } from "@/lib/server/config";
import { demoDatabases, demoEmails, demoHosting, demoRepos, demoWebsites } from "@/lib/demo";

const modes = { github: "live", vercel: "live", workers: "demo", supabase: "live", d1: "live", gmail: "error", websites: "live" } as const;

describe("deriveTasks", () => {
  const tasks = deriveTasks({
    repos: demoRepos(),
    hosting: demoHosting(),
    databases: demoDatabases(),
    emails: demoEmails(),
    websites: demoWebsites(),
    sources: [{ source: "Gmail", mode: "error", error: "401" }],
    modes,
  });
  it("prefixes every id with its scope", () => {
    expect(tasks.every((t) => /^(connector|github|vercel|workers|supabase|d1|gmail|websites)\//.test(t.id))).toBe(true);
  });
  it("marks tasks from errored or demo sources as not live", () => {
    expect(tasks.filter((t) => t.scope === "gmail").every((t) => !t.live)).toBe(true);
    expect(tasks.find((t) => t.id === "connector/Gmail")?.live).toBe(true);
  });
  it("raises failed deploys and RLS findings as critical", () => {
    expect(tasks.find((t) => t.id.startsWith("vercel/deploy-failed"))?.severity).toBe("critical");
    expect(tasks.some((t) => t.title.includes("RLS disabled") && t.severity === "critical")).toBe(true);
  });
  it("ids are unique", () => {
    expect(new Set(tasks.map((t) => t.id)).size).toBe(tasks.length);
  });
});

describe("partial failures", () => {
  const allLive = { github: "live", vercel: "live", workers: "live", supabase: "live", d1: "live", gmail: "live", websites: "live" } as const;
  const repo = demoRepos()[1];
  const tasks = deriveTasks({
    repos: [repo, { ...repo, id: "x", fullName: "kaj/unknown", openPullRequests: null, openIssues: null }],
    hosting: [],
    databases: [],
    emails: demoEmails(),
    websites: [],
    sources: [{ source: "Gmail", mode: "live", partial: [{ key: "demo:Kaj Store", error: "Kaj Store: Google token refresh failed (400)" }] }],
    modes: allLive,
  });
  it("raises a connector task while the source stays live", () => {
    const fix = tasks.find((t) => t.id === "connector/Gmail");
    expect(fix?.title).toBe("Fix the Gmail connection");
    expect(fix?.detail).toContain("Kaj Store");
  });
  it("keys email tasks by the stable mailbox id, not its editable label", () => {
    const mail = tasks.filter((t) => t.scope === "gmail");
    expect(mail.length).toBeGreaterThan(0);
    for (const t of mail) expect(t.id.startsWith(`gmail/${encodeURIComponent(`demo:${t.business}`)}/`)).toBe(true);
    const email = { ...demoEmails()[0], id: "a@x.co:m1", mailbox: "a@x.co" };
    const keyFor = (account: string) => deriveTasks({ repos: [], hosting: [], databases: [], emails: [{ ...email, account }], websites: [], sources: [], modes: allLive })[0].id;
    expect(keyFor("Old label")).toBe(keyFor("Renamed")); // relabeling keeps done/snoozed state
    expect(keyFor("x").startsWith(unobservedKeys({ gmail: [{ key: "a@x.co" }] })[0])).toBe(true);
    expect(unobservedKeys({ gmail: [{ key: "env:Kaj Store" }] })).toEqual(["gmail/env%3AKaj%20Store/"]);
  });
  it("skips repo tasks whose counts are unknown", () => {
    expect(tasks.some((t) => t.id.endsWith(":kaj/unknown"))).toBe(false);
    expect(tasks.some((t) => t.id === `github/prs:${repo.fullName}`)).toBe(true);
    expect(unobservedKeys({ github: [{ key: "kaj/unknown" }], supabase: [{ key: "ref1" }] })).toEqual([
      "supabase/advisor:ref1:",
      "github/prs:kaj/unknown",
      "github/issues:kaj/unknown",
      "github/stale:kaj/unknown",
    ]);
  });
});

describe("undecryptable connections", () => {
  it("protect that mailbox, or every scope of that provider", () => {
    expect(undecryptableGuards([{ provider: "gmail", account: "a@x.co" }, { provider: "cloudflare", account: "abc" }, { provider: "vercel", account: "t" }])).toEqual({
      unobserved: ["gmail/a%40x.co/"],
      skipScopes: ["workers", "d1", "vercel"],
    });
  });
});

describe("merging sources into one list", () => {
  const real = { ...demoEmails()[0], id: "ms:me@x.co:1", mailbox: "ms:me@x.co", subject: "Real Outlook mail" };
  it("drops demo Gmail once Outlook is live", () => {
    const inbox = mergeSources([{ mode: "demo", data: demoEmails() }, { mode: "live", data: [real] }]);
    expect(inbox).toEqual({ mode: "live", data: [real] });
  });
  it("is an error when one source fails and none is live, demo only when all are", () => {
    expect(mergeSources([{ mode: "error", data: demoEmails() }, { mode: "demo", data: [] }]).mode).toBe("error");
    const sample = demoEmails();
    expect(mergeSources([{ mode: "demo", data: sample }, { mode: "demo", data: [] }])).toEqual({ mode: "demo", data: sample });
    expect(mergeSources([{ mode: "error", data: demoEmails() }, { mode: "live", data: [real] }])).toEqual({ mode: "live", data: [real] });
  });
});

describe("email triage", () => {
  it("ranks money and security first", () => {
    expect(classifyEmail("Stripe <no-reply@stripe.com>", "Dispute opened", "", [])).toBe("critical");
    expect(classifyEmail("Namecheap <support@namecheap.com>", "Your domain expires soon", "", [])).toBe("high");
    expect(classifyEmail("Ama <ama@client.co>", "Lunch?", "", [])).toBe("medium");
    expect(classifyEmail("News <noreply@news.com>", "Weekly digest", "", [])).toBe("low");
  });
});

describe("config parsing", () => {
  it("parses rules and sites", () => {
    const rules = parseBusinessRules("kaj = Kaj Consulting\nshop=Kaj Store\nbroken", /\n/);
    expect(rules).toEqual([{ match: "kaj", business: "Kaj Consulting" }, { match: "shop", business: "Kaj Store" }]);
    expect(businessFor("Shop-Storefront", rules)).toBe("Kaj Store");
    expect(parseSites("https://Example.com/path | Biz | abcdefghijklmnopqrst\nfoo.io", /\n/)).toEqual([
      { domain: "example.com", business: "Biz", supabaseRef: "abcdefghijklmnopqrst" },
      { domain: "foo.io", business: "Unassigned" },
    ]);
  });
});

describe("connector problems", () => {
  it("merges sources that share a platform name into one task", () => {
    const tasks = deriveTasks({
      repos: [], hosting: [], databases: [], emails: [], websites: [],
      sources: [
        { source: "Cloudflare", mode: "error", error: "workers 403" },
        { source: "Cloudflare", mode: "error", error: "d1 403" },
      ],
      modes,
    });
    const cf = tasks.filter((t) => t.id === "connector/Cloudflare");
    expect(cf).toHaveLength(1);
    expect(cf[0].detail).toBe("workers 403 · d1 403");
  });
});
