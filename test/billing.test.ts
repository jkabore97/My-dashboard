import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createPublicKey, generateKeyPairSync, verify } from "node:crypto";

vi.mock("next/server", async (orig) => ({ ...(await orig<object>()), after: (fn: () => unknown) => void fn() }));

import { aggregateGcpCosts, buildCostQuery, costQueryBody, costWindow, parseCostRows, parseExportTable, parseServiceAccountKey } from "@/lib/billing/google";
import { exchangeJwt, forgetGcpTokens, gcpAccessToken, GOOGLE_TOKEN_URL, signServiceAccountJwt } from "@/lib/server/gcloud";
import { fetchGcpCosts } from "@/lib/connectors/gcloud";
import { armTokenMessage, billingErrorMessage, licenceWaste, parseBillingAccounts, parseHealthIssues, parseInvoices, parseSkus } from "@/lib/billing/microsoft";
import { fetchMsBilling } from "@/lib/connectors/msadmin";
import { forgetMsAdminTokens } from "@/lib/server/msadmin";
import { amountsIn, detectBill, detectBills, vendorKey } from "@/lib/billing/email";
import { apiSpend, billingUnobserved, combinedSpend, deriveBillingTasks, emptyBills, lastCompleteMonth, monthlyLines, monthlyTotal, resolveSpend, scopeBills, type ApiSpend } from "@/lib/billing/spend";
import { parseAnthropicCost, parseCloudflareHistory, parseCloudflareSubscriptions, parseGithubUsage, parseVercelCharges, supabasePlans, vercelPlan } from "@/lib/billing/platforms";
import { cloudflareBilling, githubBilling, vercelBilling } from "@/lib/connectors/platform-billing";
import { billCoverage } from "@/lib/billing/coverage";
import { canSeeTask, taskSection, type Access } from "@/lib/access";
import { scopeFor, type Scopable } from "@/lib/scope";
import type { Bills, GcpCostRow, MsAdminData } from "@/lib/billing/types";
import type { EmailMessage, StripeAccountSummary } from "@/lib/types";
import { getDb, pgliteDb, useDb } from "@/lib/server/db";
import { listConnectionSummaries, saveConnection } from "@/lib/server/store/connections";
import { clearSlowCaches, slowCached } from "@/lib/server/slow-cache";
import { collect, forgetExternalMemory } from "@/lib/aggregate";
import { persist } from "@/lib/server/sync";
import { listTasks } from "@/lib/server/store/tasks";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const { privateKey: PEM, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
const keyJson = (o: Record<string, unknown> = {}) => JSON.stringify({ type: "service_account", project_id: "kaj-dashboard", private_key_id: "abcdef0123456789", private_key: PEM, client_email: "kaj-dashboard@kaj-dashboard.iam.gserviceaccount.com", token_uri: "https://evil.example/token", ...o });

// ─── Google Cloud: service-account key, JWT, token exchange ──────────────────

describe("Google Cloud service account", () => {
  it("validates the pasted key and never quotes the private key in errors", () => {
    const ok = parseServiceAccountKey(keyJson());
    expect("key" in ok && ok.key).toMatchObject({ clientEmail: "kaj-dashboard@kaj-dashboard.iam.gserviceaccount.com", projectId: "kaj-dashboard", privateKeyId: "abcdef0123456789" });
    const bad = [
      parseServiceAccountKey("not json " + PEM),
      parseServiceAccountKey(keyJson({ type: "authorized_user" })),
      parseServiceAccountKey(keyJson({ client_email: "me@gmail.com" })),
      parseServiceAccountKey(keyJson({ private_key: "-----BEGIN PRIVATE KEY-----\nnope\n-----END PRIVATE KEY-----\n" })),
      parseServiceAccountKey(keyJson({ project_id: "" })),
    ];
    for (const b of bad) {
      expect("error" in b).toBe(true);
      expect(JSON.stringify(b)).not.toContain("BEGIN PRIVATE KEY-----\nMII");
      expect(JSON.stringify(b)).not.toContain(PEM.slice(40, 80));
    }
  });

  it("signs an RS256 JWT bearer assertion with the right header and claims", () => {
    const jwt = signServiceAccountJwt({ clientEmail: "sa@p.iam.gserviceaccount.com", privateKey: PEM, privateKeyId: "kid1" }, undefined, 1_700_000_000);
    const [h, c, sig] = jwt.split(".");
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT", kid: "kid1" });
    const claims = JSON.parse(Buffer.from(c, "base64url").toString());
    expect(claims).toEqual({
      iss: "sa@p.iam.gserviceaccount.com",
      scope: "https://www.googleapis.com/auth/cloud-platform.read-only https://www.googleapis.com/auth/bigquery.readonly https://www.googleapis.com/auth/cloud-billing.readonly",
      aud: "https://oauth2.googleapis.com/token",
      iat: 1_700_000_000,
      exp: 1_700_003_600,
    });
    expect(verify("RSA-SHA256", Buffer.from(`${h}.${c}`), createPublicKey(publicKey), Buffer.from(sig, "base64url"))).toBe(true);
  });

  it("exchanges the assertion at Google's token endpoint (never the file's token_uri) and caches the token", async () => {
    forgetGcpTokens();
    const calls: { url: string; body: URLSearchParams; method?: string }[] = [];
    vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
      calls.push({ url: String(input), body: new URLSearchParams(String(init?.body)), method: init?.method });
      return json({ access_token: "ya29.token", expires_in: 3599 });
    });
    const parsed = parseServiceAccountKey(keyJson());
    if (!("key" in parsed)) throw new Error("bad key");
    expect(await gcpAccessToken(parsed.key)).toBe("ya29.token");
    expect(await gcpAccessToken(parsed.key)).toBe("ya29.token");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(GOOGLE_TOKEN_URL);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].body.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    expect(calls[0].body.get("assertion")!.split(".")).toHaveLength(3);
    expect([...calls[0].body.keys()].sort()).toEqual(["assertion", "grant_type"]);
  });

  it("explains a rejected key without echoing it", async () => {
    vi.stubGlobal("fetch", async () => json({ error: "invalid_grant", error_description: "Invalid JWT Signature." }, 400));
    const err = await exchangeJwt("a.b.c").catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/rejected the service-account key/);
    expect((err as Error).message).not.toContain("a.b.c");
  });
});

// ─── Google Cloud: billing export ────────────────────────────────────────────

describe("Google Cloud billing export", () => {
  it("accepts the table id in its usual spellings and rejects anything else", () => {
    expect(parseExportTable("kaj-billing.billing_export.gcp_billing_export_v1_01ABCD_234567_89EFGH")?.id).toBe("kaj-billing.billing_export.gcp_billing_export_v1_01ABCD_234567_89EFGH");
    expect(parseExportTable("`kaj-billing:billing_export.gcp_billing_export_v1_X`")?.project).toBe("kaj-billing");
    expect(parseExportTable("kaj-billing.ds.t; DROP TABLE x")).toBeNull();
    expect(parseExportTable("ds.table")).toBeNull();
  });

  it("builds a cheap, parameterised query over the current and previous five months", () => {
    const t = parseExportTable("kaj-billing.ds.gcp_billing_export_v1_X")!;
    expect(costWindow("2026-10-03")).toEqual({ fromMonth: "202605", since: "2026-05-01" });
    const q = buildCostQuery(t);
    expect(q).toContain("FROM `kaj-billing.ds.gcp_billing_export_v1_X`");
    expect(q).toContain("invoice.month >= @from_month AND DATE(_PARTITIONTIME) >= @since");
    expect(q).toContain("GROUP BY month, project_id, project_name, service, currency");
    expect(q).toMatch(/UNNEST\(credits\)/);
    expect(buildCostQuery(t, false)).not.toContain("_PARTITIONTIME");
    const body = costQueryBody(t, "2026-10-03", "EU");
    expect(body).toMatchObject({ useLegacySql: false, parameterMode: "NAMED", location: "EU", maximumBytesBilled: "2000000000" });
    expect(body.queryParameters.map((p) => [p.name, p.parameterValue.value])).toEqual([["from_month", "202605"], ["since", "2026-05-01"]]);
  });

  const bq = {
    jobComplete: true,
    schema: { fields: ["month", "project_id", "project_name", "service", "currency", "cost", "credits"].map((name) => ({ name })) },
    rows: [
      ["202609", "kaj-store-prod", "Kaj Store", "Cloud Run", "USD", "21.504", "-1.5"],
      ["202609", "kaj-store-prod", "Kaj Store", "Cloud Firestore", "USD", "4.10", "0"],
      ["202610", "kaj-store-prod", "Kaj Store", "Cloud Run", "USD", "3.333", "0"],
      ["202609", "maps-thing", "Consulting maps", "Places API", "USD", "200", "-200"],
      ["202609", null, null, "Support", "USD", "29", "0"],
      ["202609", "kaj-bookings", "Kaj Bookings", "Firebase Hosting", "EUR", "1.2", "0"],
      ["bad", "x", "x", "x", "USD", "1", "0"],
    ].map((r) => ({ f: r.map((v) => ({ v })) })),
  };

  it("parses rows into minor units with net = cost + credits and maps projects to businesses", () => {
    const rows = parseCostRows(bq, (n) => (/store/i.test(n) ? "Kaj Store" : /bookings/i.test(n) ? "Kaj Bookings" : null));
    expect(rows).toHaveLength(6); // the zero-net Places row is kept (cost and credits non-zero); the bad month is dropped
    const run = rows.find((r) => r.service === "Cloud Run" && r.month === "2026-09")!;
    expect(run).toMatchObject({ projectId: "kaj-store-prod", currency: "usd", costMinor: 2150, creditsMinor: -150, netMinor: 2000, business: "Kaj Store" });
    expect(rows.find((r) => r.service === "Support")).toMatchObject({ projectId: null, business: null, netMinor: 2900 });
    expect(rows.find((r) => r.service === "Places API")!.netMinor).toBe(0);
  });

  it("aggregates per month, project and service without mixing currencies", () => {
    const s = aggregateGcpCosts(parseCostRows(bq, (n) => (/store/i.test(n) ? "Kaj Store" : null)));
    expect(s.months).toEqual([
      { month: "2026-09", totals: [{ currency: "usd", amount: 2000 + 410 + 0 + 2900 }, { currency: "eur", amount: 120 }] },
      { month: "2026-10", totals: [{ currency: "usd", amount: 333 }] },
    ]);
    const store = s.projects.find((p) => p.projectId === "kaj-store-prod")!;
    expect(store.byMonth["2026-09"]).toEqual([{ currency: "usd", amount: 2410 }]);
    expect(store.total).toEqual([{ currency: "usd", amount: 2743 }]);
    expect(store.business).toBe("Kaj Store");
    expect(s.projects[0].projectId).toBeNull(); // the biggest: account-level Support
    expect(s.services[0].service).toBe("Support");
  });

  it("runs the query in the dataset's location, retries without the partition filter, and fails soft", async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/datasets/ds")) return json({ location: "europe-west1" });
      if (url.endsWith("/queries")) {
        const body = JSON.parse(String(init?.body));
        bodies.push(body);
        if (String(body.query).includes("_PARTITIONTIME")) return json({ error: { message: "Unrecognized name: _PARTITIONTIME" } }, 400);
        return json(bq);
      }
      return json({}, 404);
    });
    const r = await fetchGcpCosts("tok", "kaj-billing.ds.gcp_billing_export_v1_X", [{ match: "store", business: "Kaj Store" }], "2026-10-03");
    expect(r.export).toMatchObject({ status: "ok", table: "kaj-billing.ds.gcp_billing_export_v1_X", error: null });
    expect(r.rows.find((x) => x.projectId === "kaj-store-prod")!.business).toBe("Kaj Store");
    expect(bodies).toHaveLength(2);
    expect(bodies[0].location).toBe("europe-west1");
    expect(String(bodies[1].query)).not.toContain("_PARTITIONTIME");

    expect((await fetchGcpCosts("tok", null, [], "2026-10-03")).export.status).toBe("none");
    vi.stubGlobal("fetch", async () => json({ error: { message: "Access Denied" } }, 403));
    const denied = await fetchGcpCosts("tok", "kaj-billing.ds.gcp_billing_export_v1_X", [], "2026-10-03");
    expect(denied.export.status).toBe("error");
    expect(denied.export.error).toMatch(/BigQuery Data Viewer.*BigQuery Job User/);
    vi.stubGlobal("fetch", async (input: string | URL) => (String(input).endsWith("/datasets/ds") ? json({ location: "US" }) : json({ jobComplete: true, schema: bq.schema, rows: [] })));
    const empty = await fetchGcpCosts("tok", "kaj-billing.ds.gcp_billing_export_v1_X", [], "2026-10-03");
    expect(empty.export).toMatchObject({ status: "empty" });
    expect(empty.export.error).toMatch(/about a day/);
  });
});

// ─── Microsoft 365 admin ──────────────────────────────────────────────────────

describe("Microsoft 365 admin parsing", () => {
  it("counts purchased vs assigned seats and flags only paid, unused ones", () => {
    const l = parseSkus([
      { skuPartNumber: "O365_BUSINESS_PREMIUM", capabilityStatus: "Enabled", consumedUnits: 6, prepaidUnits: { enabled: 8, warning: 0 } },
      { skuPartNumber: "EXCHANGESTANDARD", capabilityStatus: "Enabled", consumedUnits: 3, prepaidUnits: { enabled: 3 } },
      { skuPartNumber: "FLOW_FREE", capabilityStatus: "Enabled", consumedUnits: 2, prepaidUnits: { enabled: 10000 } },
      { skuPartNumber: "SPB", capabilityStatus: "Suspended", consumedUnits: 0, prepaidUnits: { enabled: 0, suspended: 5 } },
      { skuPartNumber: "AAD_PREMIUM", capabilityStatus: "Warning", consumedUnits: 1, prepaidUnits: { enabled: 0, warning: 2 } },
    ]);
    const std = l.find((x) => x.sku === "O365_BUSINESS_PREMIUM")!;
    expect(std).toMatchObject({ name: "Microsoft 365 Business Standard", purchased: 8, assigned: 6, unassigned: 2, free: false });
    expect(l.find((x) => x.sku === "FLOW_FREE")!.free).toBe(true);
    expect(licenceWaste(l).map((x) => x.sku)).toEqual(["O365_BUSINESS_PREMIUM"]);
  });

  it("keeps open service-health issues, worst first", () => {
    const h = parseHealthIssues([
      { id: "EX1", title: "Mail delays", service: "Exchange Online", status: "serviceDegradation", classification: "incident", isResolved: false, startDateTime: "2026-10-02T10:00:00Z" },
      { id: "TM1", title: "Teams down", service: "Microsoft Teams", status: "serviceInterruption", classification: "incident", isResolved: false },
      { id: "SP1", title: "Old", service: "SharePoint", status: "serviceRestored", classification: "incident", isResolved: false },
      { id: "AD1", title: "Heads-up", service: "Entra", status: "investigating", classification: "advisory", isResolved: false },
      { id: "X", title: "Done", status: "investigating", classification: "incident", isResolved: true },
    ]);
    expect(h.map((x) => [x.id, x.severity])).toEqual([["TM1", "critical"], ["EX1", "high"], ["AD1", "low"]]);
    expect(h[0].url).toContain("servicehealth");
  });

  it("parses billing accounts and refuses unsafe names", () => {
    expect(parseBillingAccounts([
      { name: "a1b2:c3d4_2019-05-31", properties: { displayName: "Kaj Group", agreementType: "MicrosoftCustomerAgreement" } },
      { name: "12345678", properties: { agreementType: "MicrosoftOnlineServicesProgram" } },
      { name: "../../evil?x=1", properties: {} },
    ])).toEqual([
      { name: "a1b2:c3d4_2019-05-31", displayName: "Kaj Group", agreement: "mca" },
      { name: "12345678", displayName: "12345678", agreement: "mosp" },
    ]);
  });

  it("reads Microsoft Customer Agreement invoices (amount objects)", () => {
    const inv = parseInvoices("acc", [
      { name: "G012345678", properties: { invoiceDate: "2026-09-05T00:00:00Z", dueDate: "2026-10-05T00:00:00Z", invoicePeriodStartDate: "2026-08-05", invoicePeriodEndDate: "2026-09-04", status: "Due", totalAmount: { currency: "USD", value: 112.5 }, amountDue: { currency: "USD", value: 112.5 }, billingProfileDisplayName: "Kaj Store profile" } },
      { name: "G011111111", properties: { invoiceDate: "2026-08-05", dueDate: "2026-09-04", status: "Due", billedAmount: { currency: "USD", value: 98.4 }, amountDue: { currency: "USD", value: 98.4 } } },
      { name: "G010000000", properties: { invoiceDate: "2026-07-05", status: "Paid", subTotal: { currency: "EUR", value: 80 }, taxAmount: { currency: "EUR", value: 16 }, amountDue: { currency: "EUR", value: 0 } } },
    ], "2026-10-03", (n) => (/store/i.test(n) ? "Kaj Store" : null));
    expect(inv.map((i) => [i.number, i.date, i.status, i.currency, i.totalMinor, i.dueMinor, i.business])).toEqual([
      ["G012345678", "2026-09-05", "due", "usd", 11250, 11250, "Kaj Store"],
      ["G011111111", "2026-08-05", "overdue", "usd", 9840, 9840, null],
      ["G010000000", "2026-07-05", "paid", "eur", 9600, 0, null],
    ]);
  });

  it("reads MOSP invoices: plain numbers with a separate currency, or no amounts at all", () => {
    const inv = parseInvoices("1234", [
      { name: "E0700ABC", properties: { invoiceDate: "2026-09-01", status: "Paid", totalAmount: 25.2, amountDue: 0, currency: "GBP" } },
      { id: "/providers/Microsoft.Billing/billingAccounts/1234/invoices/E0600XYZ", properties: { invoicePeriodStartDate: "2026-07-01", invoicePeriodEndDate: "2026-07-31" } },
    ], "2026-10-03");
    expect(inv[0]).toMatchObject({ number: "E0700ABC", currency: "gbp", totalMinor: 2520, dueMinor: 0, status: "paid" });
    expect(inv[1]).toMatchObject({ number: "E0600XYZ", totalMinor: null, currency: null, date: null, periodStart: "2026-07-01" });
  });

  it("explains billing and consent failures in actionable words", () => {
    expect(billingErrorMessage(403, "AuthorizationFailed", "boss@kaj.com")).toMatch(/Billing account reader/);
    expect(armTokenMessage("invalid_grant: AADSTS65001: The user or administrator has not consented")).toMatch(/consent/);
    expect(armTokenMessage("invalid_client: AADSTS650057: Invalid resource")).toMatch(/Azure Service Management → user_impersonation/);
  });
});

describe("Microsoft billing fetch (mocked Entra + ARM)", () => {
  beforeEach(() => {
    vi.stubEnv("MS_CLIENT_ID", "id");
    vi.stubEnv("MS_CLIENT_SECRET", "secret");
    vi.stubEnv("MS_TENANT_ID", "kaj.onmicrosoft.com");
    forgetMsAdminTokens();
  });

  it("redeems the admin refresh token for ARM and reads accounts, invoices and subscriptions", async () => {
    const scopes: string[] = [];
    vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("https://login.microsoftonline.com/kaj.onmicrosoft.com/oauth2/v2.0/token")) {
        scopes.push(new URLSearchParams(String(init?.body)).get("scope")!);
        return json({ access_token: "arm-token", expires_in: 3600 });
      }
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer arm-token");
      if (url.includes("/billingAccounts?")) return json({ value: [{ name: "acc1", properties: { displayName: "Kaj Store", agreementType: "MicrosoftCustomerAgreement" } }] });
      if (url.includes("/billingAccounts/acc1/invoices?")) {
        expect(url).toContain("periodStartDate=2025-10-01&periodEndDate=2026-10-03&api-version=2024-04-01");
        return json({ value: [{ name: "G1", properties: { invoiceDate: "2026-09-05", status: "Paid", totalAmount: { currency: "USD", value: 10 }, amountDue: { currency: "USD", value: 0 } } }] });
      }
      if (url.includes("/billingSubscriptions?")) return json({ value: [{ name: "s1", properties: { displayName: "Microsoft 365 Business Standard", status: "Active" } }] });
      return json({}, 404);
    });
    const b = await fetchMsBilling({ account: "boss@kaj.com", refreshToken: "rt" }, [{ match: "store", business: "Kaj Store" }], "2026-10-03");
    expect(scopes).toEqual(["offline_access https://management.azure.com/user_impersonation"]);
    expect(b.error).toBeNull();
    expect(b.accounts).toHaveLength(1);
    expect(b.invoices[0]).toMatchObject({ number: "G1", totalMinor: 1000, business: "Kaj Store" });
    expect(b.subscriptions[0]).toMatchObject({ name: "Microsoft 365 Business Standard", status: "Active" });
  });

  it("fails soft: consent missing, no billing role, or no billing account", async () => {
    vi.stubGlobal("fetch", async () => json({ error: "invalid_grant", error_description: "AADSTS65001: The user or administrator has not consented to use the application" }, 400));
    expect((await fetchMsBilling({ account: "boss@kaj.com", refreshToken: "rt" }, [], "2026-10-03")).error).toMatch(/consent/i);

    forgetMsAdminTokens();
    vi.stubGlobal("fetch", async (input: string | URL) => (String(input).includes("login.microsoftonline.com") ? json({ access_token: "a", expires_in: 3600 }) : json({ error: { code: "AuthorizationFailed", message: "no" } }, 403)));
    const denied = await fetchMsBilling({ account: "boss@kaj.com", refreshToken: "rt" }, [], "2026-10-03");
    expect(denied.error).toMatch(/Billing account reader/);
    expect(denied.invoices).toEqual([]);

    forgetMsAdminTokens();
    vi.stubGlobal("fetch", async (input: string | URL) => (String(input).includes("login.microsoftonline.com") ? json({ access_token: "a", expires_in: 3600 }) : json({ value: [] })));
    expect((await fetchMsBilling({ account: "boss@kaj.com", refreshToken: "rt" }, [], "2026-10-03")).error).toMatch(/sees no billing account.*Billing account reader/);
  });
});

const ms = (o: Partial<MsAdminData> = {}): MsAdminData => ({ ...emptyBills().microsoft, ...o });

describe("Microsoft 365 admin tasks", () => {
  it("turns unused paid seats into one low task per product, with the count", () => {
    const tasks = deriveBillingTasks({
      microsoft: ms({ licences: parseSkus([{ skuPartNumber: "O365_BUSINESS_PREMIUM", capabilityStatus: "Enabled", consumedUnits: 6, prepaidUnits: { enabled: 9 } }, { skuPartNumber: "FLOW_FREE", capabilityStatus: "Enabled", consumedUnits: 1, prepaidUnits: { enabled: 10000 } }]) }),
      modes: { msadmin: "live", msbilling: "live" },
    });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ id: "msadmin/licences:O365_BUSINESS_PREMIUM", title: "3 unassigned Microsoft 365 Business Standard licences", severity: "low", live: true });
    expect(tasks[0].business).toBeUndefined();
  });

  it("raises service incidents and overdue invoices; health and licences are owner-only, invoices are Money", () => {
    const tasks = deriveBillingTasks({
      microsoft: ms({
        health: parseHealthIssues([{ id: "EX1", title: "Mail delays", service: "Exchange Online", status: "serviceDegradation", classification: "incident" }]),
        billing: { ...emptyBills().microsoft.billing, invoices: parseInvoices("a", [{ name: "G9", properties: { invoiceDate: "2026-08-01", dueDate: "2026-09-01", status: "Due", totalAmount: { currency: "USD", value: 5 }, amountDue: { currency: "USD", value: 5 }, billingProfileDisplayName: "Kaj Store" } }], "2026-10-03", () => "Kaj Store") },
      }),
      modes: { msadmin: "live", msbilling: "live" },
    });
    expect(tasks.map((t) => [t.id, t.severity])).toEqual([["msadmin/health:EX1", "high"], ["msbilling/invoice:a/G9", "high"]]);
    expect(taskSection("msadmin/health:EX1")).toBe("platforms");
    expect(taskSection("msbilling/invoice:a/G9")).toBe("money");
    const accountant: Access = { role: "accountant", businesses: ["Kaj Store"] };
    expect(canSeeTask(accountant, "acc@kaj.com", { sourceKey: "msbilling/invoice:a/G9", business: "Kaj Store" })).toBe(true);
    expect(canSeeTask(accountant, "acc@kaj.com", { sourceKey: "msadmin/licences:SPB", business: null })).toBe(false);
    expect(canSeeTask({ role: "developer", businesses: null }, "dev@kaj.com", { sourceKey: "msbilling/invoice:a/G9", business: "Kaj Store" })).toBe(false);
    expect(billingUnobserved([{ key: "health" }], "no role")).toEqual(["msadmin/health:", "msbilling/"]);
  });
});

// ─── Bills in e-mail ─────────────────────────────────────────────────────────

const mail = (o: Partial<EmailMessage>): EmailMessage => ({ id: "m1", from: "", subject: "", snippet: "", receivedAt: "2026-10-01T09:00:00Z", unread: true, account: "Kaj Consulting", mailbox: "ms:office@kaj.com", labels: [], severity: "low", business: "Kaj Consulting", ...o });

describe("billing e-mail detection", () => {
  it("recognises known senders and reads one unambiguous amount", () => {
    expect(detectBill(mail({ from: "Google Payments <payments-noreply@google.com>", subject: "Google Workspace: Your invoice is available for kaj.com", snippet: "Your Google Workspace monthly invoice is available. Total: $36.00" }))).toMatchObject({ vendor: "Google Workspace", vendorKey: "google-workspace", amountMinor: 3600, currency: "usd", date: "2026-10-01", interval: "month", business: "Kaj Consulting" });
    expect(detectBill(mail({ from: "Microsoft <microsoft-noreply@microsoft.com>", subject: "Your Microsoft invoice G012345678 is ready", snippet: "Amount due: 112.50 USD. Due date: Oct 5" }))).toMatchObject({ vendor: "Microsoft", vendorKey: "microsoft", amountMinor: 11250, currency: "usd" });
    expect(detectBill(mail({ from: "Vercel Inc. <invoice+statements@stripe.com>", subject: "Your receipt from Vercel Inc. #2201-3344", snippet: "Receipt from Vercel Inc. $20.00 Paid October 1, 2026" }))).toMatchObject({ vendor: "Vercel", amountMinor: 2000 });
    expect(detectBill(mail({ from: "GitHub <noreply@github.com>", subject: "[GitHub] Payment receipt for kaj", snippet: "We received payment for your GitHub.com subscription. Total: US$4.00" }))).toMatchObject({ vendor: "GitHub", amountMinor: 400, currency: "usd" });
    expect(detectBill(mail({ from: "Starlink <no-reply@starlink.com>", subject: "Your Starlink receipt", snippet: "Thank you. CA$140.00 was charged" }))).toMatchObject({ vendor: "Starlink", currency: "cad", amountMinor: 14000 });
    expect(detectBill(mail({ from: "Anthropic <invoice@mail.anthropic.com>", subject: "Your receipt from Anthropic", snippet: "Amount paid €1,234.50" }))).toMatchObject({ vendor: "Anthropic", currency: "eur", amountMinor: 123450 });
  });

  it("stays silent when the amount is ambiguous or it isn't really a bill", () => {
    // Two different amounts.
    expect(detectBill(mail({ from: "payments-noreply@google.com", subject: "Google Workspace invoice", snippet: "Subtotal $30.00, tax $6.00" }))).toBeNull();
    // European decimal comma: not read.
    expect(detectBill(mail({ from: "billing@vercel.com", subject: "Invoice", snippet: "Total 12,34 €" }))).toBeNull();
    // No currency.
    expect(detectBill(mail({ from: "billing@vercel.com", subject: "Invoice 2026-10", snippet: "Total 36.00" }))).toBeNull();
    // Look-alike domains and unknown senders.
    expect(detectBill(mail({ from: "payments@google.com.billing-help.io", subject: "Your invoice", snippet: "$36.00" }))).toBeNull();
    expect(detectBill(mail({ from: "a@notgoogle.com", subject: "Your invoice", snippet: "$36.00" }))).toBeNull();
    // Failures, refunds, trials.
    expect(detectBill(mail({ from: "microsoft-noreply@microsoft.com", subject: "Payment failed for your Microsoft invoice", snippet: "$12.00" }))).toBeNull();
    expect(detectBill(mail({ from: "payments-noreply@google.com", subject: "Refund issued", snippet: "$12.00" }))).toBeNull();
    // Not about billing at all.
    expect(detectBill(mail({ from: "noreply@github.com", subject: "[GitHub] A new SSH key was added", snippet: "$5.00" }))).toBeNull();
    expect(amountsIn("$12.00 USD")).toEqual([{ currency: "usd", amountMinor: 1200 }]);
  });

  it("never reads a personal mailbox", () => {
    const personal = mail({ from: "payments-noreply@google.com", subject: "Google Workspace: Your invoice is available", snippet: "Total $36.00", owner: "bro@kaj.com" });
    expect(detectBill(personal)).toBeNull();
    expect(detectBills([personal, { ...personal, id: "m2", owner: undefined }]).map((b) => b.id)).toEqual(["m2"]);
  });

  it("groups vendor names for matching", () => {
    expect(["Microsoft 365 Business Standard", "Azure", "Office 365"].map(vendorKey)).toEqual(["microsoft", "microsoft", "microsoft"]);
    expect(["Google Workspace", "G Suite"].map(vendorKey)).toEqual(["google-workspace", "google-workspace"]);
    expect(["Google Cloud", "Firebase"].map(vendorKey)).toEqual(["google-cloud", "google-cloud"]);
    expect(vendorKey("Vercel Inc.")).toBe("vercel");
    expect(vendorKey("Claude Pro")).toBe("anthropic");
  });
});

// ─── Other platforms' billing APIs ───────────────────────────────────────────

describe("platform billing parsers", () => {
  it("Cloudflare billing history and subscriptions", () => {
    const c = parseCloudflareHistory([
      { id: "h1", type: "charge", action: "subscription", description: "Workers Paid", occurred_at: "2026-09-01T10:00:00Z", amount: 5, currency: "USD" },
      { id: "h2", type: "refund", description: "Refund", occurred_at: "2026-09-03T10:00:00Z", amount: 2.5, currency: "USD", zone: { name: "shop.example" } },
      { id: "h3", type: "charge", occurred_at: "bad", amount: 1, currency: "USD" },
    ], (n) => (n.includes("shop") ? "Kaj Store" : null));
    expect(c.map((x) => [x.date, x.amountMinor, x.business])).toEqual([["2026-09-01", 500, null], ["2026-09-03", -250, "Kaj Store"]]);
    expect(parseCloudflareSubscriptions([{ price: 0, currency: "USD", rate_plan: { public_name: "Free" } }, { price: 5, currency: "USD", rate_plan: { public_name: "Workers Paid" }, frequency: "monthly", state: "Paid" }, { price: 9, state: "Cancelled" }])[0]).toMatchObject({ name: "Workers Paid", amountMinor: 500 });
  });

  it("GitHub enhanced billing usage, net of included usage, per month and product", () => {
    const c = parseGithubUsage([
      { date: "2026-09-04T00:00:00Z", product: "copilot", netAmount: 10, organizationName: "kaj" },
      { date: "2026-09-10T00:00:00Z", product: "actions", grossAmount: 3, netAmount: 0 },
      { date: "2026-09-20T00:00:00Z", product: "actions", netAmount: 1.25 },
      { date: "2026-08-20T00:00:00Z", product: "actions", netAmount: 0.75 },
    ], "kaj", () => "Kaj Consulting");
    expect(c.map((x) => [x.date, x.description, x.amountMinor])).toEqual([["2026-09-01", "Actions · kaj", 125], ["2026-09-01", "Copilot · kaj", 1000], ["2026-08-01", "Actions · kaj", 75]]);
  });

  it("Vercel FOCUS charges (JSON lines) and plan", () => {
    const body = [
      JSON.stringify({ ChargePeriodStart: "2026-09-01T00:00:00Z", BilledCost: 20, BillingCurrency: "USD", ServiceName: "Pro plan" }),
      "not json",
      JSON.stringify({ ChargePeriodStart: "2026-09-12T00:00:00Z", BilledCost: 1.5, BillingCurrency: "USD", ServiceName: "Neon (Marketplace)", Tags: { ProjectName: "shop" } }),
      JSON.stringify({ ChargePeriodStart: "2026-09-13T00:00:00Z", BilledCost: 0.5, BillingCurrency: "USD", ServiceName: "Neon (Marketplace)" }),
      "",
    ].join("\n");
    const c = parseVercelCharges(body, (n) => (n === "shop" ? "Kaj Store" : null));
    expect(c.map((x) => [x.description, x.amountMinor, x.business])).toEqual([["Pro plan", 2000, null], ["Neon (Marketplace)", 200, "Kaj Store"]]);
    expect(vercelPlan({ billing: { plan: "hobby" } })).toBe("hobby");
    expect(vercelPlan({ user: { billing: { plan: "pro" } } })).toBe("pro");
  });

  it("Supabase plans and the Anthropic cost report (cents as decimal strings)", () => {
    expect(supabasePlans([{ name: "Kaj", plan: "Pro" }, { name: "Side", plan: null }])).toEqual([{ name: "Kaj", plan: "pro" }, { name: "Side", plan: "unknown" }]);
    const c = parseAnthropicCost([
      { starting_at: "2026-09-01T00:00:00Z", results: [{ amount: "1234.5678", currency: "USD", description: "Claude Opus 5.5 Usage - Input Tokens" }, { amount: "100", currency: "USD" }] },
      { starting_at: "2026-09-02T00:00:00Z", results: [{ amount: "65.4322", currency: "USD" }] },
      { starting_at: "2026-10-01T00:00:00Z", results: [{ amount: "10", currency: "USD" }] },
    ]);
    expect(c.map((x) => [x.date, x.amountMinor])).toEqual([["2026-10-01", 10], ["2026-09-01", 1400]]);
  });

  it("fail soft with the one-line fix when a token lacks billing access", async () => {
    vi.stubGlobal("fetch", async (input: string | URL) => (String(input).includes("/billing/history") ? json({ success: false, errors: [{ code: 9109, message: "Unauthorized" }] }, 403) : json({ result: [{ price: 5, currency: "USD", rate_plan: { public_name: "Workers Paid" } }] })));
    const cf = await cloudflareBilling({ token: "t", accountId: "a".repeat(32) }, []);
    expect(cf).toMatchObject({ status: "permission", plan: "Workers Paid" });
    expect(cf.message).toMatch(/Billing: Read/);

    vi.stubGlobal("fetch", async (input: string | URL) => (String(input).endsWith("/user") ? json({ login: "kaj" }) : json({ message: "Resource not accessible by personal access token" }, 403)));
    const gh = await githubBilling("t", [], "2026-10-03");
    expect(gh.status).toBe("permission");
    expect(gh.message).toMatch(/Plan: read/);

    vi.stubGlobal("fetch", async (input: string | URL) => (String(input).includes("/v2/user") ? json({ user: { billing: { plan: "hobby" } } }) : json({}, 500)));
    const vc = await vercelBilling({ token: "t", teamId: null }, [], "2026-10-03");
    expect(vc).toMatchObject({ status: "free", plan: "hobby" });
  });
});

// ─── Totals: never count a bill twice ────────────────────────────────────────

const sub = (o: { id: string; vendor: string; amountMinor?: number; currency?: string; interval?: "month" | "year"; active?: boolean; business?: string | null }) => ({ amountMinor: 1000, currency: "usd", interval: "month" as const, active: true, business: null, ...o });
const api = (vendor: ApiSpend["vendor"], amount: number, business: string | null = null): ApiSpend => ({ vendor, name: vendor, amounts: [{ currency: "usd", amount }], basis: "test", byBusiness: [{ business, currency: "usd", amount }] });

describe("double-count rule", () => {
  it("counts a billing API only when there's no manual entry for that vendor, unless the owner picks the API", () => {
    const subs = [sub({ id: "m365", vendor: "Microsoft 365 Business Standard", amountMinor: 12500 }), sub({ id: "gh", vendor: "GitHub", amountMinor: 400 }), sub({ id: "old", vendor: "Azure", active: false })];
    const apis = [api("microsoft", 11250), api("google-cloud", 3000), api("github", 1000)];

    const auto = resolveSpend(subs, apis, {});
    expect(auto.included.map((a) => a.vendor)).toEqual(["google-cloud"]);
    expect(auto.excludedSubIds.size).toBe(0);
    expect(monthlyTotal(monthlyLines(subs, auto))).toEqual([{ currency: "usd", amount: 12500 + 400 + 3000 }]);
    expect(auto.vendors.find((v) => v.vendor === "microsoft")).toMatchObject({ hasManual: true, choice: "manual", included: false });

    const picked = resolveSpend(subs, apis, { microsoft: "api" });
    expect(picked.included.map((a) => a.vendor).sort()).toEqual(["google-cloud", "microsoft"]);
    expect([...picked.excludedSubIds]).toEqual(["m365"]);
    expect(monthlyTotal(monthlyLines(subs, picked))).toEqual([{ currency: "usd", amount: 11250 + 400 + 3000 }]);

    // A stored "manual" choice for a vendor with no entry doesn't hide the API.
    expect(resolveSpend([], [api("microsoft", 11250)], { microsoft: "manual" }).included).toHaveLength(1);
  });

  it("takes Microsoft's latest invoice month and the last complete month elsewhere; only live sources", () => {
    const today = "2026-10-03";
    expect(lastCompleteMonth(["2026-10", "2026-08", "2026-09"], today)).toBe("2026-09");
    expect(lastCompleteMonth(["2026-10"], today)).toBeNull();
    const b: Bills = {
      ...emptyBills(),
      microsoft: ms({ billing: { ...emptyBills().microsoft.billing, invoices: parseInvoices("a", [
        { name: "G2", properties: { invoiceDate: "2026-09-05", status: "Due", totalAmount: { currency: "USD", value: 112.5 }, billingProfileDisplayName: "Kaj Store" } },
        { name: "G1", properties: { invoiceDate: "2026-08-05", status: "Paid", totalAmount: { currency: "USD", value: 98.4 } } },
      ], today, () => "Kaj Store") } }),
      google: { ...emptyBills().google, costs: [
        { month: "2026-10", projectId: "p", projectName: "p", service: "Run", currency: "usd", costMinor: 500, creditsMinor: 0, netMinor: 500, business: null },
        { month: "2026-09", projectId: "p", projectName: "p", service: "Run", currency: "usd", costMinor: 2500, creditsMinor: -500, netMinor: 2000, business: null },
      ] as GcpCostRow[] },
      platforms: [{ platform: "cloudflare", vendor: "Cloudflare", status: "ok", message: null, plan: null, checkedAt: null, charges: [{ id: "c", date: "2026-09-01", description: "Workers", amountMinor: 500, currency: "usd", business: null }] }],
    };
    const stripe = [{ id: "acct", business: "Kaj Store", livemode: true, revenue: [{ currency: "usd", gross: 100000, refunds: 0, fees: 3200, net: 96800 }] }] as unknown as StripeAccountSummary[];
    const all = apiSpend(b, stripe, today, { microsoft: true, google: true, platforms: true, stripe: true });
    expect(all.map((a) => [a.vendor, a.amounts[0].amount, a.basis])).toEqual([
      ["microsoft", 11250, "invoice of Sep 2026"],
      ["google-cloud", 2000, "Sep 2026"],
      ["cloudflare", 500, "Sep 2026"],
      ["stripe", 3200, "last 30 days"],
    ]);
    expect(apiSpend(b, stripe, today, { microsoft: false, google: false, platforms: false, stripe: false })).toEqual([]);
    // Detected e-mails never count, tracked or not.
    const withMail = { ...b, email: [{ id: "e", vendor: "Resend", vendorKey: "resend", amountMinor: 2000, currency: "usd", date: "2026-09-30", interval: "month" as const, subject: "", account: "", business: null, url: null }] };
    const total = combinedSpend({ records: { subscriptions: [] }, bills: withMail, stripe, modes: { msadmin: "live", gcloud: "live", billing: "live", stripe: "live" } }, today);
    expect(total.monthly).toEqual([{ currency: "usd", amount: 11250 + 2000 + 500 + 3200 }]);
  });
});

// ─── Who sees billing ────────────────────────────────────────────────────────

describe("billing access scoping", () => {
  const bills: Bills = {
    microsoft: ms({ tenant: "Kaj", licences: parseSkus([{ skuPartNumber: "SPB", capabilityStatus: "Enabled", consumedUnits: 1, prepaidUnits: { enabled: 2 } }]), health: parseHealthIssues([{ id: "X", title: "t", status: "investigating", classification: "incident" }]), billing: { accounts: [{ name: "a", displayName: "Kaj", agreement: "mca" }], invoices: [
      ...parseInvoices("a", [{ name: "S1", properties: { invoiceDate: "2026-09-01", totalAmount: { currency: "USD", value: 1 } } }], "2026-10-03", () => "Kaj Store"),
      ...parseInvoices("a", [{ name: "U1", properties: { invoiceDate: "2026-09-01", totalAmount: { currency: "USD", value: 1 } } }], "2026-10-03", () => null),
    ], subscriptions: [], error: "x", checkedAt: null } }),
    google: { serviceAccount: "sa@x.iam.gserviceaccount.com", billingAccounts: [{ id: "b", name: "B", open: true, currency: "usd" }], projects: [{ projectId: "s", name: "Store", number: null, billingAccount: "b", billingEnabled: true, firebase: true, business: "Kaj Store" }, { projectId: "c", name: "Consult", number: null, billingAccount: "b", billingEnabled: true, firebase: false, business: "Kaj Consulting" }], costs: [
      { month: "2026-09", projectId: "s", projectName: "Store", service: "Run", currency: "usd", costMinor: 1, creditsMinor: 0, netMinor: 1, business: "Kaj Store" },
      { month: "2026-09", projectId: "c", projectName: "Consult", service: "Run", currency: "usd", costMinor: 1, creditsMinor: 0, netMinor: 1, business: "Kaj Consulting" },
      { month: "2026-09", projectId: null, projectName: null, service: "Support", currency: "usd", costMinor: 1, creditsMinor: 0, netMinor: 1, business: null },
    ], export: { table: "p.d.t", status: "ok", error: null, checkedAt: null } },
    platforms: [{ platform: "github", vendor: "GitHub", status: "ok", message: "fix it", plan: "pro", checkedAt: null, charges: [{ id: "g", date: "2026-09-01", description: "Copilot", amountMinor: 1, currency: "usd", business: null }] }],
    email: [{ id: "e1", vendor: "Resend", vendorKey: "resend", amountMinor: 1, currency: "usd", date: "2026-09-01", interval: "month", subject: "s", account: "Store", business: "Kaj Store", url: null }, { id: "e2", vendor: "Zoom", vendorKey: "zoom", amountMinor: 1, currency: "usd", date: "2026-09-01", interval: "month", subject: "s", account: "x", business: null, url: null }],
  };

  it("a full owner sees everything", () => {
    expect(scopeBills(bills, { role: "owner", businesses: null })).toBe(bills);
  });

  it("someone without the Money section sees nothing", () => {
    const dev = scopeBills(bills, { role: "developer", businesses: null });
    expect(dev).toEqual(emptyBills());
  });

  it("a business-scoped accountant sees only that business's rows, nothing unmapped and no admin data", () => {
    const acc = scopeBills(bills, { role: "accountant", businesses: ["Kaj Store"] });
    expect(acc.microsoft.billing.invoices.map((i) => i.number)).toEqual(["S1"]);
    expect(acc.microsoft.licences).toEqual([]);
    expect(acc.microsoft.health).toEqual([]);
    expect(acc.microsoft.billing.error).toBeNull();
    expect(acc.microsoft.billing.accounts).toEqual([]);
    expect(acc.google.projects.map((p) => p.projectId)).toEqual(["s"]);
    expect(acc.google.costs.map((c) => c.projectId)).toEqual(["s"]);
    expect(acc.google.billingAccounts).toEqual([]);
    expect(acc.google.serviceAccount).toBeNull();
    expect(acc.platforms[0]).toMatchObject({ charges: [], message: null });
    expect(acc.email.map((e) => e.id)).toEqual(["e1"]);
  });

  it("unmapped billing stays with full owners, even for an all-business accountant; scopeFor applies it", () => {
    const acc = scopeBills(bills, { role: "accountant", businesses: null });
    expect(acc.microsoft.billing.invoices.map((i) => i.number)).toEqual(["S1"]);
    expect(acc.google.costs).toHaveLength(2);
    expect(acc.email.map((e) => e.id)).toEqual(["e1"]);
    const base = { repos: [], hosting: [], databases: [], emails: [], websites: [], stripe: [], records: { invoices: [], subscriptions: [], deadlines: [], checklist: {}, clients: [], deals: [] }, domains: { checks: [], pending: [] }, security: { alerts: [], repos: [], github2fa: null, githubLogin: null }, calendar: [], analytics: [], reviews: [], cameras: [], solar: [], notifications: [], openTasks: [], derivedTasks: [], platforms: [], sources: [], undecryptableConnections: 0, bills } as unknown as Scopable;
    const ctx = { businessForDomain: () => undefined };
    expect(scopeFor(base, { role: "assistant", businesses: null }, "a@kaj.com", ctx).bills).toEqual(emptyBills());
    expect(scopeFor(base, { role: "owner", businesses: ["Kaj Consulting"] }, "o@kaj.com", ctx).bills!.google.projects.map((p) => p.projectId)).toEqual(["c"]);
    expect(scopeFor(base, { role: "owner", businesses: null }, "o@kaj.com", ctx).bills).toBe(bills);
  });

  it("bill coverage lists each connected platform with how its bill is known", () => {
    const rows = billCoverage({
      connected: [{ id: "microsoft", mode: "live" }, { id: "msadmin", mode: "live" }, { id: "cloudflare", mode: "live" }, { id: "github", mode: "live" }, { id: "gmail", mode: "live" }, { id: "websites", mode: "live" }, { id: "resend", mode: "live" }],
      bills: { ...emptyBills(), platforms: [{ platform: "cloudflare", vendor: "Cloudflare", status: "permission", message: "Add \"Billing: Read\" to the Cloudflare API token to read invoices.", plan: null, charges: [], checkedAt: null }], email: [{ id: "e", vendor: "Resend", vendorKey: "resend", amountMinor: 1, currency: "usd", date: "2026-09-30", interval: "month", subject: "", account: "", business: null, url: null }] },
      api: [api("github", 1000)],
      subs: [{ vendor: "Microsoft 365", active: true }],
    });
    expect(rows.map((r) => [r.id, r.how])).toEqual([["cloudflare", "none"], ["gmail", "none"], ["msadmin", "manual"], ["resend", "email"], ["github", "api"]]);
    expect(rows[0].fix).toMatch(/Billing: Read/);
    expect(rows.some((r) => r.id === "websites" || r.id === "microsoft")).toBe(false);
  });
});

// ─── With a database ─────────────────────────────────────────────────────────

describe("billing end to end (PGlite)", () => {
  beforeAll(async () => {
    await useDb(await pgliteDb());
  });
  beforeEach(async () => {
    vi.stubEnv("MS_CLIENT_ID", "id");
    vi.stubEnv("MS_CLIENT_SECRET", "secret");
    vi.stubEnv("MS_TENANT_ID", "kaj.onmicrosoft.com");
    vi.stubEnv("BUSINESS_TIMEZONE", "UTC");
    vi.stubEnv("SAMPLE_DATA", "off");
    const db = await getDb();
    await db.exec("truncate tasks, task_activity, events, connections, settings, audit_log cascade");
    forgetExternalMemory();
    forgetMsAdminTokens();
  });

  it("caches slow billing reads by input, and drops them on reconnect", async () => {
    let n = 0;
    const read = () => slowCached("t", ["a"], async () => ++n, () => 60_000);
    expect(await read()).toBe(1);
    expect(await read()).toBe(1);
    expect(await slowCached("t", ["b"], async () => ++n, () => 60_000)).toBe(2);
    const db = await getDb();
    const [row] = await db.query<{ value: { data: string } }>("select value from settings where key = 'cache:slow:t'");
    expect(JSON.stringify(row.value)).not.toContain('"b"'); // inputs are hashed, data encrypted
    await clearSlowCaches();
    expect(await slowCached("t", ["b"], async () => ++n, () => 60_000)).toBe(3);
  });

  it("stores the Google Cloud key encrypted and shows only the export table", async () => {
    await saveConnection({ provider: "gcloud", account: "sa@p.iam.gserviceaccount.com", label: "p", secret: { clientEmail: "sa@p.iam.gserviceaccount.com", privateKey: PEM, projectId: "p", exportTable: "p.d.t" }, meta: { exportTable: "p.d.t" } });
    const db = await getDb();
    const [row] = await db.query<{ secret: string }>("select secret from connections where provider = 'gcloud'");
    expect(row.secret).not.toContain("PRIVATE KEY");
    const [summary] = await listConnectionSummaries();
    expect(summary).toMatchObject({ provider: "gcloud", exportTable: "p.d.t" });
    expect(JSON.stringify(summary)).not.toContain("PRIVATE KEY");
  });

  it("reads Microsoft 365 admin, raises the licence task, and detects bills from shared mailboxes only", async () => {
    await saveConnection({ provider: "msadmin", account: "boss@kaj.com", secret: { refreshToken: "rt-admin" }, meta: { via: "oauth" } });
    await saveConnection({ provider: "microsoft", account: "office@kaj.com", business: "Kaj Consulting", secret: { refreshToken: "rt-office" } });
    await getDb().then((db) => db.query(`insert into users (email, role, notify_prefs) values ('bro@kaj.com', 'owner', '{}'::jsonb) on conflict do nothing`));
    await saveConnection({ provider: "microsoft", account: "bro@kaj.com", secret: { refreshToken: "rt-bro" }, ownerEmail: "bro@kaj.com" });
    const invoiceMail = (id: string) => ({ id, subject: "Google Workspace: Your invoice is available for kaj.com", bodyPreview: "Your Google Workspace monthly invoice is available. Total: $36.00", receivedDateTime: new Date().toISOString(), isRead: false, importance: "normal", webLink: "https://outlook.office.com/x", from: { emailAddress: { name: "Google Payments", address: "payments-noreply@google.com" } } });
    vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("https://login.microsoftonline.com/")) {
        const rt = new URLSearchParams(String(init?.body)).get("refresh_token");
        return json({ access_token: `at-${rt}`, expires_in: 3600 });
      }
      const auth = (init?.headers as Record<string, string> | undefined)?.Authorization ?? "";
      if (url.includes("/subscribedSkus")) return json({ value: [{ skuPartNumber: "O365_BUSINESS_PREMIUM", capabilityStatus: "Enabled", consumedUnits: 4, prepaidUnits: { enabled: 6 } }] });
      if (url.includes("/serviceAnnouncement/issues")) return json({ value: [] });
      if (url.includes("/organization")) return json({ value: [{ displayName: "Kaj" }] });
      if (url.includes("management.azure.com")) return json({ value: [] });
      // Each mailbox's own messages: the personal one would detect too, if it were ever read.
      if (url.includes("/me/mailFolders/inbox/messages") || url.includes("/me/messages?")) return json({ value: [invoiceMail(auth.includes("rt-bro") ? "BRO1" : "OFF1")] });
      if (url.includes("/me/calendarView")) return json({ value: [] });
      return json({ message: "not stubbed" }, 404);
    });
    const c = await collect();
    expect(c.modes.msadmin).toBe("live");
    expect(c.bills.microsoft.licences[0]).toMatchObject({ unassigned: 2 });
    expect(c.bills.microsoft.billing.error).toMatch(/sees no billing account/);
    expect(c.derivedTasks.find((t) => t.id === "msadmin/licences:O365_BUSINESS_PREMIUM")).toMatchObject({ title: "2 unassigned Microsoft 365 Business Standard licences", live: true });
    expect(c.unobserved).toContain("msbilling/");
    expect(c.bills.email.map((b) => b.id)).toEqual(["ms:office@kaj.com:OFF1"]);
    expect(c.bills.email[0]).toMatchObject({ vendor: "Google Workspace", amountMinor: 3600, business: "Kaj Consulting" });

    await persist(c, { force: true, alerts: false });
    const open = await listTasks("open");
    expect(open.find((t) => t.sourceKey === "msadmin/licences:O365_BUSINESS_PREMIUM")).toMatchObject({ severity: "low" });
  });
});
