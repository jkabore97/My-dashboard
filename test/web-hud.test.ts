import { describe, expect, it } from "vitest";
import { averageBuildMs, bucketStatus, commitHeatmap, deployMarks, expiryRows, formatBytes, hasDeployHistory, languageCounts, medianResponse, pctLabel, securityScore, scoreWord, uptimePct, weeklyTotals } from "@/components/web/logic";
import { parseCommitActivity } from "@/lib/connectors/github";
import { groupDeployments } from "@/lib/connectors/vercel";
import { mapD1 } from "@/lib/connectors/cloudflare";
import type { HostingProject, SecurityReport } from "@/lib/types";
import type { DomainCheck } from "@/lib/server/domains";

const H = 3_600_000;
const NOW = Date.parse("2026-10-02T12:00:00Z");
const at = (hoursAgo: number) => new Date(NOW - hoursAgo * H).toISOString();

describe("uptime", () => {
  const pts = [
    { status: "up" as const, responseMs: 100, takenAt: at(23.5) },
    { status: "down" as const, responseMs: null, takenAt: at(23.4) },
    { status: "up" as const, responseMs: 300, takenAt: at(1) },
    { status: "degraded" as const, responseMs: 1500, takenAt: at(0.5) },
    { status: "up" as const, responseMs: 999, takenAt: at(48) }, // outside the window
  ];
  it("keeps the worst status per bucket and leaves unchecked buckets empty", () => {
    const b = bucketStatus(pts, NOW - 24 * H, NOW, 24);
    expect(b[0]).toBe("down");
    expect(b[23]).toBe("degraded");
    expect(b[10]).toBeNull();
    expect(b.length).toBe(24);
  });
  it("computes uptime share and medians", () => {
    expect(uptimePct([])).toBeNull();
    expect(uptimePct(pts.slice(0, 4))).toBe(50);
    const m = medianResponse(pts, NOW - 24 * H, NOW, 2);
    expect(m[0]).toBe(100); // the down check has no time
    expect(m[1]).toBe(900); // (300 + 1500) / 2
  });
  it("labels percentages without rounding a dip up to 100", () => {
    expect(pctLabel(100)).toBe("100%");
    expect(pctLabel(99.999)).toBe("100%");
    expect(pctLabel(99.987)).toBe("99.98%");
    expect(pctLabel(97.25)).toBe("97.3%");
  });
});

describe("domain expiry timeline", () => {
  const check = (domain: string, cert: string, reg: string | null, ok = true): DomainCheck => ({
    domain,
    checkedAt: "2026-10-02T00:00:00Z",
    registration: ok ? { ok: true, expiresOn: reg, registrar: null } : { ok: false, error: "rdap" },
    certificate: { ok: true, expiresOn: cert, issuer: null },
    email: { ok: true, mx: [], spf: null, dmarc: null, dmarcPolicy: null, dkim: [] },
  });
  it("places expiries on the horizon with their alert severity", () => {
    const [a, b] = expiryRows([check("a.com", "2026-10-11", "2027-10-02"), check("b.com", "2028-01-01", null, false)], "2026-10-02");
    expect(a.ssl).toMatchObject({ days: 9, severity: "medium" });
    expect(a.ssl!.frac).toBeCloseTo(9 / 365);
    expect(a.reg).toMatchObject({ days: 365, frac: 1, severity: null });
    expect(b.ssl!.frac).toBe(1); // clamped past the horizon
    expect(b.reg).toBeNull(); // lookup failed: unknown, not "fine"
  });
});

describe("security score", () => {
  const security: SecurityReport = {
    alerts: [
      { kind: "dependabot", repo: "o/a", number: 1, severity: "high", title: "x", url: "", createdAt: "" },
      { kind: "dependabot", repo: "o/a", number: 2, severity: "low", title: "y", url: "", createdAt: "" },
    ],
    repos: [{ repo: "o/a", dependabot: "on", secretScanning: "on" }, { repo: "o/b", dependabot: "off", secretScanning: "unknown" }],
    github2fa: true,
    githubLogin: "o",
  };
  it("averages the areas that have data, from transparent penalties", () => {
    const r = securityScore({ security, codeKnown: true, twofa: { confirmed: 3, total: 4 }, databases: [{ advisories: [{ level: "medium", title: "m" }] }], databaseKnown: true });
    expect(r.parts.map((p) => [p.key, p.score])).toEqual([["code", 100 - 15 - 2 - 3], ["twofa", 75], ["database", 95]]);
    expect(r.score).toBe(Math.round((80 + 75 + 95) / 3));
  });
  it("leaves out areas without data and never goes below zero", () => {
    const many = { ...security, alerts: Array.from({ length: 6 }, (_, i) => ({ ...security.alerts[0], number: i, severity: "critical" as const })) };
    const r = securityScore({ security: many, codeKnown: true, twofa: { confirmed: 0, total: 0 }, databases: [], databaseKnown: false });
    expect(r.parts).toHaveLength(1);
    expect(r.score).toBe(0);
    expect(securityScore({ security, codeKnown: false, twofa: { confirmed: 0, total: 0 }, databases: [], databaseKnown: false }).score).toBeNull();
    expect([scoreWord(95), scoreWord(80), scoreWord(10)]).toEqual(["Secure", "Fair", "At risk"]);
  });
});

describe("repos", () => {
  it("counts languages and sums commit activity across repos by week", () => {
    expect(languageCounts([{ language: "TypeScript" }, { language: null }, { language: "Python" }, { language: "TypeScript" }])).toEqual([{ language: "TypeScript", count: 2 }, { language: "Python", count: 1 }]);
    const a = { activity: [{ weekStart: "2026-09-20", days: [0, 1, 2, 0, 0, 0, 0] }, { weekStart: "2026-09-27", days: [1, 1, 1, 1, 1, 1, 1] }] };
    const b = { activity: [{ weekStart: "2026-09-27", days: [0, 0, 0, 0, 0, 0, 3] }] };
    const h = commitHeatmap([a, b, {}]);
    expect(h).toMatchObject({ total: 13, repos: 2 });
    expect(h!.weeks[1].days[6]).toBe(4);
    expect(commitHeatmap([{}])).toBeNull();
    expect(weeklyTotals(a, 1)).toEqual([7]);
  });
  it("parses GitHub commit_activity and rejects the still-computing response", () => {
    expect(parseCommitActivity({})).toBeNull();
    expect(parseCommitActivity([])).toBeNull();
    expect(parseCommitActivity([{ week: 1, days: [1, 2] }])).toBeNull();
    const weeks = Array.from({ length: 52 }, (_, i) => ({ week: 1_759_000_000 + i * 604_800, total: 7, days: [1, 1, 1, 1, 1, 1, 1] }));
    const r = parseCommitActivity(weeks)!;
    expect(r).toHaveLength(26);
    expect(r[25].weekStart).toBe(new Date((1_759_000_000 + 51 * 604_800) * 1000).toISOString().slice(0, 10));
  });
});

describe("hosting", () => {
  it("groups Vercel deployments by project with build times", () => {
    const g = groupDeployments([
      { projectId: "p1", created: NOW - 2 * H, buildingAt: NOW - 2 * H, ready: NOW - 2 * H + 41_000, readyState: "READY" },
      { projectId: "p1", created: NOW - H, readyState: "ERROR" },
      { created: NOW }, // no project: skipped
    ]);
    expect(g.get("p1")).toEqual([
      { at: at(1), state: "error", buildMs: null },
      { at: at(2), state: "ready", buildMs: 41_000 },
    ]);
  });
  it("places deploys on the last 24 hours and averages build time", () => {
    const base = { url: null, framework: null, lastDeployState: "ready" as const };
    const hosting: HostingProject[] = [
      { ...base, id: "v", name: "v", provider: "vercel", lastDeployAt: at(1), recentDeploys: [{ at: at(6), state: "ready", buildMs: 30_000 }, { at: at(30), state: "ready", buildMs: 50_000 }] },
      { ...base, id: "w", name: "w", provider: "cloudflare", lastDeployAt: at(18) },
      { ...base, id: "x", name: "x", provider: "vercel", lastDeployAt: at(2) }, // no history: not plotted
    ];
    const m = deployMarks(hosting, NOW);
    expect(m.map((x) => x.project)).toEqual(["w", "v"]);
    expect(m[1].frac).toBeCloseTo(18 / 24);
    expect(averageBuildMs(hosting)).toBe(40_000);
    expect(hasDeployHistory(hosting)).toBe(true);
    expect(hasDeployHistory([hosting[2]])).toBe(false);
  });
});

describe("databases", () => {
  it("maps D1 size only when Cloudflare reports it", () => {
    expect(mapD1({ uuid: "u", name: "db", created_at: "2026-01-01", file_size: 2048, num_tables: 3 }, [])).toMatchObject({ sizeBytes: 2048, tables: 3, provider: "cloudflare-d1" });
    expect(mapD1({ uuid: "u", name: "db", created_at: "2026-01-01" }, [])).toMatchObject({ sizeBytes: null, tables: null });
    expect(JSON.parse(JSON.stringify(mapD1({ uuid: "u", name: "db", created_at: "x", file_size: 1 }, [])))).toMatchObject({ sizeBytes: 1 });
  });
  it("formats bytes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(38_412_288)).toBe("36.6 MB");
    expect(formatBytes(5 * 1024 ** 3)).toBe("5.0 GB");
  });
});
