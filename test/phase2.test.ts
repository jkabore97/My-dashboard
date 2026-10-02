import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:tls";
import { addMonths, daysBetween, isDate, nextOccurrence, rollForward, today } from "@/lib/dates";
import { formatMoney, parseAmount, sumByCurrency, toInputAmount, toMonthly } from "@/lib/money";
import { deriveRiskTasks, registrationSeverity, certificateSeverity, deadlineSeverity, type RiskInput } from "@/lib/risk";
import { sinceHour, summarize } from "@/lib/connectors/stripe";
import { classifyAlertError } from "@/lib/connectors/security";
import { CHAIN_PROBLEM, checkDomain, certificateProblem, parseEmailAuth, parseRdap, registrableDomain, tlsCertificate, txtValues, type Lookups } from "@/lib/server/domains";
import { dailyRevenue, moneyByBusiness, moneyOverview } from "@/lib/money-summary";
import { demoStripe } from "@/lib/demo";

describe("dates", () => {
  it("validates and does calendar math", () => {
    expect(isDate("2026-02-29")).toBe(false);
    expect(isDate("2028-02-29")).toBe(true);
    expect(daysBetween("2026-10-01", "2026-10-15")).toBe(14);
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(nextOccurrence("2026-03-31", "quarterly")).toBe("2026-06-30");
    expect(nextOccurrence("2026-03-31", "none")).toBeNull();
  });
  it("repeats from the anchor day so month ends don't drift", () => {
    const steps = (start: string, r: "monthly" | "quarterly", n: number) => {
      const out: string[] = [];
      let cur = start;
      for (let i = 0; i < n; i++) out.push((cur = nextOccurrence(cur, r, Number(start.slice(8)))!));
      return out;
    };
    expect(steps("2026-03-31", "quarterly", 4)).toEqual(["2026-06-30", "2026-09-30", "2026-12-31", "2027-03-31"]);
    expect(steps("2026-01-31", "monthly", 4)).toEqual(["2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31"]);
    expect(nextOccurrence("2026-06-30", "quarterly")).toBe("2026-09-30"); // no anchor: the date's own day
  });
  it("rolls renewals forward without month-end drift", () => {
    expect(rollForward("2026-01-31", "month", "2026-03-15")).toBe("2026-03-31");
    expect(rollForward("2025-06-10", "year", "2026-10-02")).toBe("2027-06-10");
    expect(rollForward("2026-11-01", "month", "2026-10-02")).toBe("2026-11-01");
  });
  it("evaluates today in the business timezone", () => {
    const late = new Date("2026-10-02T03:00:00Z");
    expect(today("UTC", late)).toBe("2026-10-02");
    expect(today("America/Los_Angeles", late)).toBe("2026-10-01");
  });
});

describe("money", () => {
  it("formats zero-decimal currencies correctly", () => {
    expect(formatMoney(123456, "usd")).toBe("$1,234.56");
    expect(formatMoney(5000, "xof")).toMatch(/5,000/);
    expect(formatMoney(5000, "jpy")).toMatch(/5,000/);
    expect(formatMoney(2125, "usd", { compact: true })).toBe("$21.25");
    expect(formatMoney(1_560_000, "usd", { compact: true })).toBe("$15.6K");
  });
  it("respects each currency's decimals", () => {
    expect(parseAmount("1234.5", "jpy")).toBeNull();
    expect(parseAmount("1234", "xof")).toBe(1234);
    expect(parseAmount("12.345", "bhd")).toBe(12345);
    expect(parseAmount("12.3456", "bhd")).toBeNull();
    expect(formatMoney(12345, "bhd")).toMatch(/12\.345/);
    expect(formatMoney(12345, "kwd")).not.toMatch(/123\.45/);
    expect(toInputAmount(12345, "bhd")).toBe("12.345");
  });
  it("parses typed amounts", () => {
    expect(parseAmount("1,250.5", "usd")).toBe(125050);
    expect(parseAmount("5000", "xof")).toBe(5000);
    expect(parseAmount("12.345", "usd")).toBeNull();
    expect(parseAmount("-3", "usd")).toBeNull();
  });
  it("normalizes to monthly and sums per currency", () => {
    expect(toMonthly(12000, "year")).toBe(1000);
    expect(toMonthly(3000, "month", 3)).toBe(1000);
    expect(sumByCurrency([{ currency: "usd", amount: 1 }, { currency: "EUR", amount: 5 }, { currency: "USD", amount: 2 }])).toEqual([{ currency: "eur", amount: 5 }, { currency: "usd", amount: 3 }]);
  });
});

describe("Stripe summary", () => {
  const day = 1_790_000_000;
  const s = summarize(
    { id: "acct_1", business: "Kaj" },
    true,
    { available: [{ amount: 1000, currency: "usd" }], pending: [{ amount: 50, currency: "usd" }] },
    [
      { id: "t1", amount: 10000, fee: 320, net: 9680, currency: "usd", type: "charge", created: day },
      { id: "t2", amount: -2000, fee: 0, net: -2000, currency: "usd", type: "refund", created: day },
      { id: "t3", amount: -9000, fee: 0, net: -9000, currency: "usd", type: "payout", created: day },
      { id: "t4", amount: 5000, fee: 0, net: 5000, currency: "eur", type: "payment", created: day + 86400 },
    ],
    [
      { id: "s1", status: "active", items: { data: [{ quantity: 2, price: { unit_amount: 1000, currency: "usd", recurring: { interval: "month", interval_count: 1 } } }] } },
      { id: "s2", status: "active", items: { data: [{ price: { unit_amount: 12000, currency: "usd", recurring: { interval: "year", interval_count: 1 } } }] } },
      { id: "s3", status: "past_due", items: { data: [{ price: { unit_amount: 500, currency: "usd", recurring: { interval: "month", interval_count: 1 } } }] } },
    ],
    [
      { id: "dp_1", amount: 4800, currency: "usd", reason: "fraudulent", status: "needs_response", created: day, evidence_details: { due_by: day + 7 * 86400 } },
      { id: "dp_2", amount: 100, currency: "usd", reason: "general", status: "won", created: day },
    ],
    [{ id: "in_1", number: "A-1", amount_remaining: 3000, currency: "usd", due_date: day, customer_name: null, customer_email: "a@b.c", hosted_invoice_url: null }],
    false,
  );
  it("buckets daily revenue by the business's calendar day", () => {
    const evening = Date.parse("2026-10-02T02:00:00Z") / 1000; // Oct 1, 7 pm in Los Angeles
    const txn = [{ id: "t", amount: 100, fee: 0, net: 100, currency: "usd", type: "charge", created: evening }];
    const la = summarize({ id: "a", business: "K" }, true, { available: [], pending: [] }, txn, [], [], [], false, "America/Los_Angeles");
    const utc = summarize({ id: "a", business: "K" }, true, { available: [], pending: [] }, txn, [], [], [], false, "UTC");
    expect(la.daily[0].date).toBe("2026-10-01");
    expect(utc.daily[0].date).toBe("2026-10-02");
  });
  it("keeps Stripe list URLs stable within the hour so the fetch cache hits", () => {
    const t = Date.parse("2026-10-02T10:05:00Z");
    expect(sinceHour(30, t)).toBe(sinceHour(30, t + 50 * 60_000));
    expect(Number(sinceHour(30, t)) % 3600).toBe(0);
  });
  it("counts income, refunds and fees but not payouts", () => {
    expect(s.revenue.find((r) => r.currency === "usd")).toEqual({ currency: "usd", gross: 10000, refunds: 2000, fees: 320, net: 7680 });
    expect(s.daily.map((d) => d.currency)).toEqual(["usd", "eur"]);
  });
  it("computes MRR from active and past-due subscriptions", () => {
    expect(s.mrr).toEqual([{ currency: "usd", amount: 2000 + 1000 + 500 }]);
    expect(s.activeSubscriptions).toBe(2);
    expect(s.pastDueSubscriptions).toBe(1);
  });
  it("keeps only open disputes and unpaid invoices", () => {
    expect(s.disputes.map((d) => d.id)).toEqual(["dp_1"]);
    expect(s.openInvoices[0]).toMatchObject({ client: "a@b.c", amount: 3000, source: "stripe" });
  });
});

describe("domain checks", () => {
  it("finds the registrable domain", () => {
    expect(registrableDomain("portal.kajconsulting.com")).toBe("kajconsulting.com");
    expect(registrableDomain("shop.example.co.uk")).toBe("example.co.uk");
    expect(registrableDomain("example.com")).toBe("example.com");
  });
  it("parses RDAP", () => {
    const r = parseRdap({ events: [{ eventAction: "registration", eventDate: "2020-01-01T00:00:00Z" }, { eventAction: "expiration", eventDate: "2027-03-04T12:00:00Z" }], entities: [{ roles: ["registrar"], vcardArray: ["vcard", [["version", {}, "text", "4.0"], ["fn", {}, "text", "Namecheap, Inc."]]] }] });
    expect(r).toEqual({ expiresOn: "2027-03-04", registrar: "Namecheap, Inc." });
  });
  it("joins split TXT strings and reads DMARC policy", () => {
    expect(txtValues([{ type: 16, data: '"v=spf1 include:_spf.google.com " "~all"' }, { type: 5, data: "cname." }])).toEqual(["v=spf1 include:_spf.google.com ~all"]);
    const e = parseEmailAuth({ mx: ["mx.x"], rootTxt: ["google-site-verification=abc", "v=spf1 -all"], dmarcTxt: ["v=DMARC1; p=quarantine; rua=mailto:x@y"], dkimFound: [] });
    expect(e).toMatchObject({ spf: "v=spf1 -all", dmarcPolicy: "quarantine" });
  });
  it("runs every check through injected lookups and survives partial failure", async () => {
    const answers: Record<string, unknown> = {
      "MX:kaj.com": { Status: 0, Answer: [{ type: 15, data: "10 aspmx.l.google.com." }] },
      "TXT:kaj.com": { Status: 0, Answer: [{ type: 16, data: '"v=spf1 include:_spf.google.com ~all"' }] },
      "TXT:_dmarc.kaj.com": { Status: 3 },
      "TXT:google._domainkey.kaj.com": { Status: 0, Answer: [{ type: 16, data: '"v=DKIM1; k=rsa; p=MIIB"' }] },
    };
    const lookups: Lookups = {
      fetchJson: async (url) => {
        if (url.startsWith("https://rdap.org/")) throw new Error("403 from rdap.org");
        const u = new URL(url);
        return answers[`${u.searchParams.get("type")}:${u.searchParams.get("name")}`] ?? { Status: 3 };
      },
      certificate: async () => ({ expiresOn: "2026-12-01", issuer: "Let's Encrypt" }),
    };
    const c = await checkDomain("www.kaj.com", ["google", "selector1"], lookups);
    expect(c.registration).toEqual({ ok: false, error: "403 from rdap.org" });
    expect(c.certificate).toEqual({ ok: true, expiresOn: "2026-12-01", issuer: "Let's Encrypt" });
    expect(c.email).toMatchObject({ ok: true, mx: ["aspmx.l.google.com"], dmarc: null, dkim: ["google"] });
  });
});

describe("TLS certificate check", () => {
  let server: Server;
  let port = 0;
  let cert = "";
  beforeAll(async () => {
    const dir = mkdtempSync(join(tmpdir(), "kcc-tls-"));
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(dir, "k.pem"), "-out", join(dir, "c.pem"), "-days", "30", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost"], { stdio: "ignore" });
    cert = readFileSync(join(dir, "c.pem"), "utf8");
    server = createServer({ key: readFileSync(join(dir, "k.pem")), cert }, (s) => s.end());
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    port = (server.address() as { port: number }).port;
  });
  afterAll(() => server?.close());

  it("reads an untrusted certificate instead of failing, and says why", async () => {
    const c = await tlsCertificate("localhost", port);
    expect(c).toMatchObject({ valid: false, problem: "self-signed", issuer: "localhost" });
    expect(c.expiresOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it("trusts it once its CA is trusted, and flags a host-name mismatch", async () => {
    expect(await tlsCertificate("localhost", port, cert)).toMatchObject({ valid: true, problem: null });
    // Same server reached by IP: the certificate only names localhost.
    expect(await tlsCertificate("127.0.0.1", port, cert)).toMatchObject({ valid: false, problem: "issued for a different host name" });
  });
});

describe("security alerts", () => {
  it("tells disabled features from real failures", () => {
    class E extends Error { constructor(public status: number, m: string) { super(m); } }
    // Only the connector's own HttpError is classified; anything else is a failure.
    expect(classifyAlertError(new E(403, "403 Dependabot alerts are disabled for this repository."))).toBe("error");
    expect(classifyAlertError(new Error("boom"))).toBe("error");
  });
});

describe("thresholds", () => {
  it("escalates as dates approach", () => {
    expect([45, 30, 14, 3, -1].map(registrationSeverity)).toEqual([null, "low", "high", "critical", "critical"]);
    expect([30, 20, 7, 2].map(certificateSeverity)).toEqual([null, "medium", "high", "critical"]);
    expect(deadlineSeverity(20, 14)).toBeNull();
    expect(deadlineSeverity(10, 14)).toBe("medium");
    expect(deadlineSeverity(2, 14)).toBe("high");
    expect(deadlineSeverity(-1, 14)).toBe("critical");
  });
});

const base = (): RiskInput => ({
  today: "2026-10-02",
  stripe: [],
  records: { invoices: [], subscriptions: [], deadlines: [], checklist: {} },
  domains: { checks: [], pending: [] },
  security: { alerts: [], repos: [], github2fa: null, githubLogin: null },
  sites: [{ domain: "kaj.com", business: "Kaj Consulting" }],
  repos: [],
  modes: { stripe: "live", invoices: "live", subscriptions: "live", deadlines: "live", checklist: "live", domains: "live", security: "live", gmail: "demo", vercel: "live", workers: "demo", supabase: "demo" },
  partial: { stripe: [], security: [] },
});

describe("risk tasks", () => {
  it("raises overdue invoices, escalating after 30 days", () => {
    const r = base();
    r.records.invoices = [
      { id: "i1", business: "Kaj", client: "ClientCo", number: "K-1", amountMinor: 360000, currency: "usd", issuedOn: null, dueOn: "2026-09-20", status: "open", paidOn: null, notes: null },
      { id: "i2", business: "Kaj", client: "Old", number: null, amountMinor: 100, currency: "usd", issuedOn: null, dueOn: "2026-08-01", status: "open", paidOn: null, notes: null },
      { id: "i3", business: "Kaj", client: "Future", number: null, amountMinor: 100, currency: "usd", issuedOn: null, dueOn: "2026-10-20", status: "open", paidOn: null, notes: null },
      { id: "i4", business: "Kaj", client: "Paid", number: null, amountMinor: 100, currency: "usd", issuedOn: null, dueOn: "2026-08-01", status: "paid", paidOn: "2026-08-02", notes: null },
    ];
    const tasks = deriveRiskTasks(r).tasks.filter((t) => t.scope === "invoices");
    expect(tasks.map((t) => [t.id, t.severity])).toEqual([["invoices/i1", "high"], ["invoices/i2", "critical"]]);
    expect(tasks[0].detail).toContain("$3,600.00 · 12 days late");
  });

  it("warns before renewals, and loudly when auto-renew is off", () => {
    const r = base();
    const sub = { business: null, plan: null, amountMinor: 2000, currency: "usd", url: null, notes: null, active: true };
    r.records.subscriptions = [
      { ...sub, id: "s1", vendor: "Vercel", interval: "month", nextRenewal: "2026-09-05", autoRenew: true }, // rolls to 2026-10-05
      { ...sub, id: "s2", vendor: "Domain", interval: "year", nextRenewal: "2026-10-10", autoRenew: false },
      { ...sub, id: "s3", vendor: "Far", interval: "year", nextRenewal: "2027-05-01", autoRenew: true },
      { ...sub, id: "s4", vendor: "Stopped", interval: "month", nextRenewal: "2026-10-03", autoRenew: true, active: false },
    ];
    const tasks = deriveRiskTasks(r).tasks.filter((t) => t.scope === "subscriptions");
    expect(tasks.map((t) => [t.id, t.severity, t.title])).toEqual([
      ["subscriptions/s1:2026-10-05", "low", "Vercel renews in 3 days"],
      ["subscriptions/s2:2026-10-10", "high", "Domain expires in 8 days"],
    ]);
  });

  it("puts deadlines on the list inside their reminder window, keyed by due date", () => {
    const r = base();
    r.records.deadlines = [
      { id: "d1", business: null, title: "Q4 estimated tax", category: "tax", dueOn: "2026-10-15", recurrence: "quarterly", remindDays: 14, notes: null, url: null, completedOn: null },
      { id: "d2", business: null, title: "Insurance", category: "insurance", dueOn: "2026-12-01", recurrence: "yearly", remindDays: 30, notes: null, url: null, completedOn: null },
      { id: "d3", business: null, title: "Done", category: "other", dueOn: "2026-09-01", recurrence: "none", remindDays: 14, notes: null, url: null, completedOn: "2026-09-01" },
    ];
    const tasks = deriveRiskTasks(r).tasks.filter((t) => t.scope === "deadlines");
    expect(tasks.map((t) => [t.id, t.severity])).toEqual([["deadlines/d1:2026-10-15", "medium"]]);
  });

  it("asks to confirm 2FA only for platforms in use", () => {
    const r = base();
    r.records.checklist = { vercel: "2026-01-10T00:00:00Z" };
    const ids = deriveRiskTasks(r).tasks.map((t) => t.id);
    expect(ids).toContain("checklist/stripe");
    expect(ids).toContain("checklist/registrar");
    expect(ids).not.toContain("checklist/vercel"); // confirmed this year
    expect(ids).not.toContain("checklist/google"); // Gmail not connected
  });

  it("turns domain checks into tasks and protects failed checks", () => {
    const r = base();
    r.domains = {
      checks: [{
        domain: "www.kaj.com", checkedAt: "",
        registration: { ok: true, expiresOn: "2026-10-12", registrar: "Namecheap" },
        certificate: { ok: false, error: "timeout" },
        email: { ok: true, mx: ["mx"], spf: null, dmarc: "v=DMARC1; p=none", dmarcPolicy: "none", dkim: [] },
      }],
      pending: ["new.io"],
    };
    const out = deriveRiskTasks(r);
    const tasks = out.tasks.filter((t) => t.scope === "domains");
    const unobserved = out.unobserved;
    expect(tasks.map((t) => [t.id, t.severity])).toEqual([
      ["domains/registration:kaj.com", "high"],
      ["domains/spf:kaj.com", "high"],
      ["domains/dmarc-none:kaj.com", "low"],
      ["domains/dkim:kaj.com", "low"],
    ]);
    expect(tasks[0].business).toBe("Kaj Consulting");
    expect(unobserved).toContain("domains/certificate:www.kaj.com");
    expect(unobserved).toContain("domains/registration:new.io");
  });

  it("links polled alerts and disputes to their webhook tasks", () => {
    const r = base();
    r.stripe = demoStripe();
    r.security = { alerts: [{ kind: "dependabot", repo: "kaj/a", number: 3, severity: "high", title: "Vulnerable x", url: "u", createdAt: "" }, { kind: "dependabot", repo: "kaj/a", number: 4, severity: "low", title: "minor", url: "u", createdAt: "" }], repos: [{ repo: "kaj/a", dependabot: "on", secretScanning: "on" }], github2fa: false, githubLogin: "kaj" };
    r.repos = ["kaj/a", "kaj/b"];
    const { tasks, unobserved } = deriveRiskTasks(r);
    expect(tasks.find((t) => t.id.endsWith("dispute:dp_demo"))?.alias).toBe("stripe-dispute:dp_demo");
    expect(tasks.find((t) => t.id === "security/kaj/a/dependabot:3")?.alias).toBe("github-dependabot:kaj/a:3");
    expect(tasks.some((t) => t.id.endsWith("dependabot:4"))).toBe(false); // low alerts stay on the Security page
    expect(tasks.find((t) => t.id === "security/github-2fa")?.severity).toBe("critical");
    expect(unobserved).toContain("security/kaj/b/"); // not checked this round
  });

  it("maps chain errors to the chain problem", () => {
    for (const code of ["UNABLE_TO_VERIFY_LEAF_SIGNATURE", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "UNABLE_TO_GET_ISSUER_CERT"]) expect(certificateProblem(code)).toBe(CHAIN_PROBLEM);
    expect(certificateProblem("CERT_HAS_EXPIRED")).toBe("expired");
  });

  it("raises a critical task for an invalid or expired certificate, high for an incomplete chain", () => {
    const r = base();
    const check = (domain: string, certificate: object) => ({ domain, checkedAt: "", registration: { ok: false as const, error: "x" }, certificate, email: { ok: false as const, error: "x" } });
    r.domains = {
      checks: [
        check("bad.kaj.com", { ok: true, expiresOn: "2027-01-01", issuer: "Me", valid: false, problem: "self-signed" }),
        check("old.kaj.com", { ok: true, expiresOn: "2026-09-01", issuer: "LE", valid: false, problem: "expired" }),
        check("fine.kaj.com", { ok: true, expiresOn: "2027-01-01", issuer: "LE", valid: true, problem: null }),
        check("chain.kaj.com", { ok: true, expiresOn: "2027-01-01", issuer: "Sectigo", valid: false, problem: CHAIN_PROBLEM }),
        check("wronghost.kaj.com", { ok: true, expiresOn: "2027-01-01", issuer: "LE", valid: false, problem: "issued for a different host name" }),
        check("revoked.kaj.com", { ok: true, expiresOn: "2027-01-01", issuer: "LE", valid: false, problem: "revoked" }),
        check("oldchain.kaj.com", { ok: true, expiresOn: "2026-09-01", issuer: "LE", valid: false, problem: CHAIN_PROBLEM }),
        check("legacy.kaj.com", { ok: true, expiresOn: "2026-10-03", issuer: "LE" }), // stored before validity was recorded
      ] as RiskInput["domains"]["checks"],
      pending: [],
    };
    const tasks = deriveRiskTasks(r).tasks.filter((t) => t.id.startsWith("domains/certificate:"));
    expect(tasks.map((t) => [t.id, t.severity, t.title])).toEqual([
      ["domains/certificate:bad.kaj.com", "critical", "SSL certificate for bad.kaj.com is invalid: self-signed"],
      ["domains/certificate:old.kaj.com", "critical", "SSL certificate for old.kaj.com expired"],
      ["domains/certificate:chain.kaj.com", "high", "SSL certificate chain for chain.kaj.com is incomplete"],
      ["domains/certificate:wronghost.kaj.com", "critical", "SSL certificate for wronghost.kaj.com is invalid: issued for a different host name"],
      ["domains/certificate:revoked.kaj.com", "critical", "SSL certificate for revoked.kaj.com is invalid: revoked"],
      ["domains/certificate:oldchain.kaj.com", "critical", "SSL certificate for oldchain.kaj.com expired"],
      ["domains/certificate:legacy.kaj.com", "critical", "SSL certificate for legacy.kaj.com expires tomorrow"],
    ]);
  });

  it("keeps checklist items while their platform is failing or unknown", () => {
    const r = base();
    r.modes.vercel = "error";
    let out = deriveRiskTasks(r);
    expect(out.tasks.some((t) => t.id === "checklist/vercel")).toBe(false);
    expect(out.unobserved).toContain("checklist/vercel");
    r.modes.vercel = "demo";
    r.credentialsKnown = false;
    expect(deriveRiskTasks(r).unobserved).toContain("checklist/vercel");
    r.credentialsKnown = true; // really not connected: the item may close
    out = deriveRiskTasks(r);
    expect(out.unobserved).not.toContain("checklist/vercel");
    expect(out.tasks.some((t) => t.id === "checklist/vercel")).toBe(false);
  });

  it("links a polled overdue Stripe invoice to the payment-failed webhook task", () => {
    const r = base();
    r.stripe = demoStripe();
    const inv = deriveRiskTasks(r).tasks.find((t) => t.id.includes("/invoice:"));
    expect(inv?.alias).toBe(`stripe-invoice:${inv!.id.split("/invoice:")[1]}`);
  });

  it("ignores test-mode Stripe accounts", () => {
    const r = base();
    const [live, other] = demoStripe();
    r.stripe = [live, { ...other, id: "acct_test", livemode: false }];
    const stripeTasks = deriveRiskTasks(r).tasks.filter((t) => t.scope === "stripe");
    expect(stripeTasks.length).toBeGreaterThan(0);
    expect(stripeTasks.every((t) => t.id.startsWith(`stripe/${encodeURIComponent(live.id)}/`))).toBe(true);
  });

  it("protects a Stripe account that failed this round", () => {
    const r = base();
    r.partial.stripe = ["acct_9"];
    expect(deriveRiskTasks(r).unobserved).toContain("stripe/acct_9/");
  });
});

describe("money overview", () => {
  it("leaves test-mode Stripe accounts out of every roll-up", () => {
    const records = { invoices: [], subscriptions: [], deadlines: [], checklist: {} };
    const [live, other] = demoStripe();
    const test = { ...other, id: "acct_test", business: "Sandbox", livemode: false };
    const both = moneyOverview([live, test], records, today());
    const liveOnly = moneyOverview([live], records, today());
    expect(both.gross30d).toEqual(liveOnly.gross30d);
    expect(both.mrr).toEqual(liveOnly.mrr);
    expect(both.available).toEqual(liveOnly.available);
    expect(both.receivables).toEqual(liveOnly.receivables);
    expect(dailyRevenue([live, test], today())).toEqual(dailyRevenue([live], today()));
    expect(moneyByBusiness([live, test], records, today()).has("Sandbox")).toBe(false);
  });

  it("combines Stripe and manual receivables and fills 30 days", () => {
    const records = { invoices: [{ id: "m1", business: "Kaj", client: "Manual", number: null, amountMinor: 500, currency: "usd", issuedOn: null, dueOn: "2026-01-01", status: "open" as const, paidOn: null, notes: null }], subscriptions: [], deadlines: [], checklist: {} };
    const m = moneyOverview(demoStripe(), records, today());
    expect(m.receivables.some((r) => r.source === "manual" && r.editable && r.daysLate! > 0)).toBe(true);
    expect(m.overdueCount).toBeGreaterThanOrEqual(2);
    const chart = dailyRevenue(demoStripe(), today());
    expect(chart.days).toHaveLength(30);
    expect(chart.days[29].date).toBe(today());
  });
});
