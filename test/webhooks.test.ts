import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { verifyGithub, verifyStripe, verifySharedSecret, verifyVercel } from "@/lib/server/webhooks";
import { handleGithub, handleStripe, handleSupabase, handleVercel } from "@/lib/server/webhook-handlers";

const body = JSON.stringify({ hello: "world" });

describe("webhook signatures", () => {
  it("GitHub sha256", () => {
    const sig = "sha256=" + createHmac("sha256", "s3cret").update(body).digest("hex");
    expect(verifyGithub("s3cret", body, sig)).toBe(true);
    expect(verifyGithub("other", body, sig)).toBe(false);
    expect(verifyGithub("s3cret", body + " ", sig)).toBe(false);
    expect(verifyGithub("s3cret", body, null)).toBe(false);
  });
  it("Vercel sha1", () => {
    const sig = createHmac("sha1", "s3cret").update(body).digest("hex");
    expect(verifyVercel("s3cret", body, sig)).toBe(true);
    expect(verifyVercel("s3cret", body, "00" + sig.slice(2))).toBe(false);
  });
  it("Stripe with timestamp tolerance", () => {
    const t = 1_700_000_000;
    const v1 = createHmac("sha256", "whsec_x").update(`${t}.${body}`).digest("hex");
    expect(verifyStripe("whsec_x", body, `t=${t},v1=${v1}`, t + 10)).toBe(true);
    expect(verifyStripe("whsec_x", body, `t=${t},v1=deadbeef,v1=${v1}`, t + 10)).toBe(true);
    expect(verifyStripe("whsec_x", body, `t=${t},v1=${v1}`, t + 301)).toBe(false);
    expect(verifyStripe("whsec_x", body, `v1=${v1}`, t)).toBe(false);
  });
  it("shared secret header, with or without Bearer", () => {
    expect(verifySharedSecret("abc", "abc")).toBe(true);
    expect(verifySharedSecret("abc", "Bearer abc")).toBe(true);
    expect(verifySharedSecret("abc", "abd")).toBe(false);
  });
});

describe("webhook handlers", () => {
  it("GitHub CI failure on default branch opens a task; success resolves it", () => {
    const repo = { full_name: "kaj/site", default_branch: "main" };
    const fail = handleGithub("workflow_run", "d1", { action: "completed", repository: repo, workflow_run: { name: "CI", head_branch: "main", conclusion: "failure", html_url: "https://x" } });
    expect(fail.openTasks[0]).toMatchObject({ key: "github-ci:kaj/site:CI:main", severity: "high" });
    const ok = handleGithub("workflow_run", "d2", { action: "completed", repository: repo, workflow_run: { name: "CI", head_branch: "main", conclusion: "success" } });
    expect(ok.resolveTasks).toEqual(["github-ci:kaj/site:CI:main"]);
  });
  it("GitHub feature-branch failure is an event only", () => {
    const out = handleGithub("workflow_run", "d3", { action: "completed", repository: { full_name: "kaj/site", default_branch: "main" }, workflow_run: { name: "CI", head_branch: "feat", conclusion: "failure" } });
    expect(out.openTasks).toHaveLength(0);
    expect(out.events[0].severity).toBe("medium");
  });
  it("Dependabot severity maps through", () => {
    const out = handleGithub("dependabot_alert", "d4", { action: "created", repository: { full_name: "kaj/site" }, alert: { number: 7, security_advisory: { severity: "critical", summary: "RCE" }, dependency: { package: { name: "next" } } } });
    expect(out.openTasks[0]).toMatchObject({ severity: "critical", key: "github-dependabot:kaj/site:7" });
  });
  it("Stripe dispute → critical task with amount; closed → resolve", () => {
    const opened = handleStripe({ id: "evt_1", type: "charge.dispute.created", livemode: true, created: 1, data: { object: { id: "dp_1", amount: 48000, currency: "usd", reason: "fraudulent", evidence_details: { due_by: 1_800_000_000 } } } });
    expect(opened.openTasks[0].title).toBe("Respond to $480.00 dispute");
    expect(opened.openTasks[0].severity).toBe("critical");
    const closed = handleStripe({ id: "evt_2", type: "charge.dispute.closed", data: { object: { id: "dp_1", amount: 48000, currency: "usd", status: "won" } } });
    expect(closed.resolveTasks).toEqual(["stripe-dispute:dp_1"]);
  });
  it("Stripe test-mode events are recorded, labelled, and never open or close tasks", () => {
    const dispute = handleStripe({ id: "evt_t1", type: "charge.dispute.created", livemode: false, created: 1, data: { object: { id: "dp_t", amount: 100, currency: "usd", reason: "fraudulent" } } });
    expect(dispute.openTasks).toEqual([]);
    expect(dispute.events).toHaveLength(1);
    expect(dispute.events[0].title).toBe("Payment dispute: $1.00 (test)");
    expect(dispute.events[0].url).toContain("/test/");
    const paid = handleStripe({ id: "evt_t2", type: "invoice.paid", livemode: false, data: { object: { id: "in_t", amount_paid: 100, currency: "usd" } } });
    expect(paid.resolveTasks).toEqual([]);
    expect(paid.events[0].title).toMatch(/\(test\)$/);
    const payout = handleStripe({ id: "evt_t3", type: "payout.failed", livemode: false, data: { object: { id: "po_t", amount: 100, currency: "usd" } } });
    expect(payout.openTasks).toEqual([]);
  });
  it("Vercel production error is critical", () => {
    const out = handleVercel({ id: "v1", type: "deployment.error", payload: { target: "production", deployment: { name: "portal", url: "portal.vercel.app" } } });
    expect(out.events[0]).toMatchObject({ severity: "critical", dedupeKey: "vercel:v1" });
  });
  it("Supabase auth sign-up event", () => {
    const raw = JSON.stringify({ type: "INSERT", schema: "auth", table: "users", record: { email: "a@b.c" } });
    const out = handleSupabase(raw, JSON.parse(raw), "shop.example");
    expect(out.events[0].title).toBe("New sign-up on shop.example");
  });
});
