import { formatMoney } from "../money";
import { sha256Hex } from "./crypto";
import { recordEvent, type NewEvent } from "./store/events";
import { resolveEventTask, upsertEventTask } from "./store/tasks";
import type { Severity } from "../types";

// Each handler turns a verified platform payload into events (history /
// notifications) and, for things that need action, event tasks that close
// themselves when the platform reports the problem fixed.

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

interface Outcome {
  events: NewEvent[];
  openTasks: { key: string; title: string; detail?: string; severity: Severity; source: string; url?: string; business?: string }[];
  resolveTasks: string[];
}

const empty = (): Outcome => ({ events: [], openTasks: [], resolveTasks: [] });

export async function apply(outcome: Outcome) {
  const now = new Date().toISOString();
  for (const e of outcome.events) await recordEvent(e);
  for (const t of outcome.openTasks) await upsertEventTask(t.key, { ...t, createdAt: now });
  for (const key of outcome.resolveTasks) await resolveEventTask(key);
  return { events: outcome.events.length, tasks: outcome.openTasks.length, resolved: outcome.resolveTasks.length };
}

const money = (amount: number, currency: string) => formatMoney(amount, currency);

const ALERT_SEVERITY: Record<string, Severity> = { critical: "critical", high: "high", medium: "medium", low: "low" };

export function handleGithub(event: string, delivery: string, p: Json): Outcome {
  const out = empty();
  const repo: string = p.repository?.full_name ?? "unknown";
  const ev = (e: Omit<NewEvent, "dedupeKey" | "source" | "kind">) => out.events.push({ dedupeKey: `github:${delivery}`, source: "GitHub", kind: event, ...e });

  switch (event) {
    case "workflow_run": {
      const run = p.workflow_run;
      if (p.action !== "completed" || !run) break;
      const key = `github-ci:${repo}:${run.name}:${run.head_branch}`;
      const isDefault = run.head_branch === p.repository?.default_branch;
      if (run.conclusion === "failure" || run.conclusion === "timed_out") {
        ev({ title: `CI failed: ${run.name} on ${repo}@${run.head_branch}`, severity: isDefault ? "high" : "medium", url: run.html_url });
        if (isDefault) out.openTasks.push({ key, title: `CI failing on ${repo} (${run.name})`, detail: `Branch ${run.head_branch}`, severity: "high", source: "GitHub Actions", url: run.html_url });
      } else if (run.conclusion === "success") {
        out.resolveTasks.push(key);
      }
      break;
    }
    case "pull_request": {
      const pr = p.pull_request;
      if (!pr || !["opened", "reopened", "ready_for_review", "closed"].includes(p.action)) break;
      const verb = p.action === "closed" ? (pr.merged ? "merged" : "closed") : p.action.replace(/_/g, " ");
      ev({ title: `PR ${verb}: ${pr.title}`, body: `${repo} #${pr.number} by ${pr.user?.login}`, severity: p.action === "closed" ? "low" : "medium", url: pr.html_url });
      break;
    }
    case "issues": {
      if (!["opened", "reopened"].includes(p.action) || !p.issue) break;
      ev({ title: `Issue ${p.action}: ${p.issue.title}`, body: `${repo} #${p.issue.number}`, severity: "low", url: p.issue.html_url });
      break;
    }
    case "dependabot_alert": {
      const a = p.alert;
      if (!a) break;
      const key = `github-dependabot:${repo}:${a.number}`;
      const sev = ALERT_SEVERITY[a.security_advisory?.severity ?? a.security_vulnerability?.severity] ?? "high";
      if (["created", "reopened", "reintroduced"].includes(p.action)) {
        const pkg = a.dependency?.package?.name ?? "a dependency";
        ev({ title: `Dependabot (${sev}): ${pkg} in ${repo}`, body: a.security_advisory?.summary, severity: sev, url: a.html_url });
        out.openTasks.push({ key, title: `Patch vulnerable ${pkg} in ${repo}`, detail: a.security_advisory?.summary, severity: sev, source: "GitHub security", url: a.html_url });
      } else if (["fixed", "dismissed", "auto_dismissed"].includes(p.action)) {
        out.resolveTasks.push(key);
      }
      break;
    }
    case "secret_scanning_alert": {
      const a = p.alert;
      if (!a) break;
      const key = `github-secret:${repo}:${a.number}`;
      if (["created", "reopened"].includes(p.action)) {
        ev({ title: `Leaked secret detected in ${repo}`, body: a.secret_type_display_name ?? a.secret_type, severity: "critical", url: a.html_url });
        out.openTasks.push({ key, title: `Rotate leaked ${a.secret_type_display_name ?? "secret"} in ${repo}`, severity: "critical", source: "GitHub security", url: a.html_url });
      } else if (p.action === "resolved") {
        out.resolveTasks.push(key);
      }
      break;
    }
    case "deployment_status": {
      const st = p.deployment_status?.state;
      if (st === "failure" || st === "error") ev({ title: `Deployment ${st}: ${repo} (${p.deployment?.environment})`, severity: "high", url: p.deployment_status?.target_url ?? undefined });
      break;
    }
    case "push": {
      if (!p.after || /^0+$/.test(p.after)) break;
      const n = p.commits?.length ?? 0;
      ev({ title: `${n} commit${n === 1 ? "" : "s"} pushed to ${repo}@${String(p.ref).replace("refs/heads/", "")}`, body: p.head_commit?.message?.split("\n")[0], severity: "low", url: p.compare });
      break;
    }
  }
  return out;
}

export function handleVercel(p: Json): Outcome {
  const out = empty();
  const type: string = p.type ?? "";
  const d = p.payload?.deployment ?? {};
  const name = d.name ?? p.payload?.name ?? "project";
  const prod = p.payload?.target === "production";
  const url = p.payload?.links?.deployment ?? (d.url ? `https://${d.url}` : undefined);
  const base = { dedupeKey: `vercel:${p.id}`, source: "Vercel", kind: type, url, occurredAt: p.createdAt ? new Date(p.createdAt).toISOString() : undefined };
  if (type === "deployment.error") out.events.push({ ...base, title: `${name}: ${prod ? "production " : ""}deploy failed`, severity: prod ? "critical" : "high" });
  else if (type === "deployment.succeeded" || type === "deployment.ready") out.events.push({ ...base, title: `${name}: ${prod ? "production " : ""}deploy succeeded`, severity: "low" });
  else if (type === "deployment.canceled") out.events.push({ ...base, title: `${name}: deploy canceled`, severity: "low" });
  else if (type === "deployment.created") out.events.push({ ...base, title: `${name}: deploy started`, severity: "low" });
  else if (type.startsWith("project.")) out.events.push({ ...base, title: `Vercel ${type.replace(".", " ")}: ${p.payload?.project?.name ?? name}`, severity: "low" });
  return out;
}

export function handleStripe(p: Json): Outcome {
  const out = empty();
  const o = p.data?.object ?? {};
  const base = { dedupeKey: `stripe:${p.id}`, source: "Stripe", kind: p.type as string, occurredAt: p.created ? new Date(p.created * 1000).toISOString() : undefined };
  const dash = (path: string) => `https://dashboard.stripe.com/${p.livemode ? "" : "test/"}${path}`;
  switch (p.type) {
    case "charge.dispute.created": {
      const due = o.evidence_details?.due_by ? new Date(o.evidence_details.due_by * 1000).toDateString() : null;
      const title = `Payment dispute: ${money(o.amount, o.currency)}`;
      out.events.push({ ...base, title, body: o.reason, severity: "critical", url: dash(`disputes/${o.id}`) });
      out.openTasks.push({ key: `stripe-dispute:${o.id}`, title: `Respond to ${money(o.amount, o.currency)} dispute`, detail: due ? `Evidence due ${due}` : o.reason, severity: "critical", source: "Stripe", url: dash(`disputes/${o.id}`) });
      break;
    }
    case "charge.dispute.closed":
      out.events.push({ ...base, title: `Dispute ${o.status}: ${money(o.amount, o.currency)}`, severity: o.status === "won" ? "low" : "high", url: dash(`disputes/${o.id}`) });
      out.resolveTasks.push(`stripe-dispute:${o.id}`);
      break;
    case "invoice.payment_failed":
      out.events.push({ ...base, title: `Invoice payment failed: ${money(o.amount_due, o.currency)}`, body: o.customer_email ?? undefined, severity: "high", url: o.hosted_invoice_url ?? dash(`invoices/${o.id}`) });
      out.openTasks.push({ key: `stripe-invoice:${o.id}`, title: `Follow up failed payment ${money(o.amount_due, o.currency)}`, detail: o.customer_email ?? undefined, severity: "high", source: "Stripe", url: dash(`invoices/${o.id}`) });
      break;
    case "invoice.paid":
      out.events.push({ ...base, title: `Invoice paid: ${money(o.amount_paid, o.currency)}`, body: o.customer_email ?? undefined, severity: "low", url: dash(`invoices/${o.id}`) });
      out.resolveTasks.push(`stripe-invoice:${o.id}`);
      break;
    case "payout.failed":
      out.events.push({ ...base, title: `Payout failed: ${money(o.amount, o.currency)}`, body: o.failure_message ?? undefined, severity: "critical", url: dash(`payouts/${o.id}`) });
      out.openTasks.push({ key: `stripe-payout:${o.id}`, title: `Fix failed payout of ${money(o.amount, o.currency)}`, detail: o.failure_message ?? undefined, severity: "critical", source: "Stripe", url: dash(`payouts/${o.id}`) });
      break;
    case "radar.early_fraud_warning.created":
      out.events.push({ ...base, title: "Early fraud warning on a charge", body: o.fraud_type, severity: "critical", url: dash(`payments/${o.charge}`) });
      out.openTasks.push({ key: `stripe-efw:${o.id}`, title: "Review early fraud warning (consider refunding)", detail: o.fraud_type, severity: "critical", source: "Stripe", url: dash(`payments/${o.charge}`) });
      break;
    case "charge.succeeded":
    case "checkout.session.completed": {
      const amount = o.amount ?? o.amount_total;
      if (amount != null) out.events.push({ ...base, title: `Payment received: ${money(amount, o.currency)}`, body: o.billing_details?.email ?? o.customer_details?.email ?? undefined, severity: "low", url: dash("payments") });
      break;
    }
    case "charge.failed":
      out.events.push({ ...base, title: `Charge failed: ${money(o.amount, o.currency)}`, body: o.failure_message ?? undefined, severity: "medium", url: dash("payments") });
      break;
    case "customer.subscription.deleted":
      out.events.push({ ...base, title: "Subscription canceled", body: o.customer ?? undefined, severity: "medium", url: dash("subscriptions") });
      break;
  }
  return out;
}

export function handleSupabase(raw: string, p: Json, site: string | null): Outcome {
  const out = empty();
  const where = site ?? "your site";
  const base = { dedupeKey: `supabase:${sha256Hex(raw)}`, source: "Supabase", kind: `${p.schema}.${p.table}:${p.type}` };
  if (p.schema === "auth" && p.table === "users" && p.type === "INSERT") {
    out.events.push({ ...base, title: `New sign-up on ${where}`, body: p.record?.email ?? undefined, severity: "low", url: site ? `https://${site}` : undefined });
  } else if (p.table && p.type) {
    out.events.push({ ...base, title: `${p.type} on ${p.schema}.${p.table}${site ? ` (${site})` : ""}`, severity: "low" });
  }
  return out;
}
