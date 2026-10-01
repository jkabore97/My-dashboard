import { describe, expect, it } from "vitest";
import { deriveTasks } from "@/lib/aggregate";
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
