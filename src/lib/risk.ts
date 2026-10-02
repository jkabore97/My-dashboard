import { daysBetween, formatDate, relativeDays, rollForward } from "./dates";
import { formatMoney } from "./money";
import type { Records } from "./connectors/records";
import type { DomainsReport } from "./connectors/records";
import { CHAIN_PROBLEM, registrableDomain } from "./server/domains";
import { businessForDomain, type SiteConfig } from "./server/config";
import { ACCOUNT_CHECKLIST, CONFIRMATION_VALID_DAYS } from "./security-checklist";
import type { ReceivableInvoice, SecurityReport, Severity, SourceMode, StripeAccountSummary, Task } from "./types";

// Phase 2 rules: money, domains, security and deadlines → tasks. Pure, so the
// thresholds are unit-tested; collect() feeds it and persist() stores it.

export type RiskScope = "stripe" | "invoices" | "subscriptions" | "deadlines" | "checklist" | "domains" | "security";

export interface RiskTask extends Task {
  scope: RiskScope;
  live: boolean;
  /** Key of the webhook task for the same problem; when that exists, this one is dropped. */
  alias?: string;
}

export interface RiskInput {
  today: string;
  stripe: StripeAccountSummary[];
  records: Records;
  domains: DomainsReport;
  security: SecurityReport;
  sites: SiteConfig[];
  /** Repos known to exist (for "not checked this round" protection). */
  repos: string[];
  modes: Record<RiskScope | "gmail" | "vercel" | "workers" | "supabase", SourceMode>;
  /** Partial failures: Stripe account ids, security keys ("dependabot:<repo>", "secret:<repo>"). */
  partial: { stripe: string[]; security: string[] };
  /** False when stored connections couldn't all be read, so "demo" may not mean "not connected". */
  credentialsKnown?: boolean;
}

const enc = encodeURIComponent;

/** Days late → severity for money owed to you. */
export function overdueSeverity(daysLate: number): Severity {
  return daysLate > 30 ? "critical" : "high";
}

/** Registration expiry: 30 / 14 / 3 days → low / high / critical. */
export function registrationSeverity(daysLeft: number): Severity | null {
  if (daysLeft <= 3) return "critical";
  if (daysLeft <= 14) return "high";
  if (daysLeft <= 30) return "low";
  return null;
}

/** Certificates normally auto-renew ~30 days out, so warn later and louder. */
export function certificateSeverity(daysLeft: number): Severity | null {
  if (daysLeft <= 2) return "critical";
  if (daysLeft <= 7) return "high";
  if (daysLeft <= 20) return "medium";
  return null;
}

export function deadlineSeverity(daysLeft: number, remindDays: number): Severity | null {
  if (daysLeft < 0) return "critical";
  if (daysLeft > remindDays) return null;
  return daysLeft <= 3 ? "high" : "medium";
}

function receivableTask(inv: ReceivableInvoice, today: string): Omit<Task, "id"> | null {
  if (!inv.dueOn || inv.dueOn >= today) return null;
  const late = daysBetween(inv.dueOn, today);
  return {
    title: `Chase overdue invoice${inv.number ? ` ${inv.number}` : ""} from ${inv.client}`,
    detail: `${formatMoney(inv.amount, inv.currency)} · ${late} day${late === 1 ? "" : "s"} late (due ${formatDate(inv.dueOn)})`,
    severity: overdueSeverity(late),
    source: inv.source === "stripe" ? "Stripe" : "Receivables",
    url: inv.url ?? "/money#receivables",
    createdAt: `${inv.dueOn}T00:00:00.000Z`,
    business: inv.business ?? undefined,
  };
}

export function deriveRiskTasks(r: RiskInput): { tasks: RiskTask[]; unobserved: string[] } {
  const tasks: RiskTask[] = [];
  const seen = new Set<string>();
  const unobserved: string[] = [];
  const now = new Date().toISOString();
  const add = (scope: RiskScope, key: string, t: Omit<Task, "id">, alias?: string) => {
    const id = `${scope}/${key}`;
    if (seen.has(id)) return;
    seen.add(id);
    tasks.push({ ...t, id, scope, live: r.modes[scope] === "live", ...(alias ? { alias } : {}) });
  };

  // ─── Stripe ─── (test-mode accounts are connected for trying things out; their problems aren't real)
  for (const a of r.stripe) {
    if (!a.livemode && !a.sample) continue; // samples still give the demo to-do list its examples (never live)
    const p = `${enc(a.id)}/`;
    for (const d of a.disputes) {
      if (d.status !== "needs_response" && d.status !== "warning_needs_response") continue;
      add("stripe", `${p}dispute:${d.id}`, {
        title: `Respond to ${formatMoney(d.amount, d.currency)} dispute`,
        detail: d.dueBy ? `Evidence due ${formatDate(d.dueBy.slice(0, 10))} · ${d.reason.replace(/_/g, " ")}` : d.reason.replace(/_/g, " "),
        severity: "critical",
        source: "Stripe",
        url: `https://dashboard.stripe.com/${a.livemode ? "" : "test/"}disputes/${d.id}`,
        createdAt: d.created,
        business: a.business,
      }, `stripe-dispute:${d.id}`);
    }
    for (const inv of a.openInvoices) {
      const t = receivableTask(inv, r.today);
      if (t) add("stripe", `${p}invoice:${inv.id}`, t, `stripe-invoice:${inv.id}`); // same key as the payment-failed webhook task
    }
    if (a.pastDueSubscriptions > 0) {
      add("stripe", `${p}past-due`, {
        title: `${a.pastDueSubscriptions} subscription${a.pastDueSubscriptions === 1 ? "" : "s"} past due at ${a.business}`,
        detail: "Payments are failing; Stripe will retry, but reach out before they cancel.",
        severity: "medium",
        source: "Stripe",
        url: `https://dashboard.stripe.com/${a.livemode ? "" : "test/"}subscriptions?status=past_due`,
        createdAt: now,
        business: a.business,
      });
    }
  }
  for (const id of r.partial.stripe) unobserved.push(`stripe/${enc(id)}/`);

  // ─── Receivables you track by hand ───
  for (const inv of r.records.invoices) {
    if (inv.status !== "open") continue;
    const t = receivableTask({ id: inv.id, source: "manual", business: inv.business, client: inv.client, number: inv.number, amount: inv.amountMinor, currency: inv.currency, dueOn: inv.dueOn }, r.today);
    if (t) add("invoices", inv.id, t);
  }

  // ─── Subscriptions (renewals) ───
  for (const s of r.records.subscriptions) {
    if (!s.active || !s.nextRenewal) continue;
    const next = s.autoRenew ? rollForward(s.nextRenewal, s.interval, r.today) : s.nextRenewal;
    const days = daysBetween(r.today, next);
    const cost = `${formatMoney(s.amountMinor, s.currency)}/${s.interval === "month" ? "mo" : "yr"}`;
    if (s.autoRenew && days <= 7) {
      add("subscriptions", `${s.id}:${next}`, { title: `${s.vendor} renews ${relativeDays(days)}`, detail: `${cost}${s.plan ? ` · ${s.plan}` : ""}. Cancel now if you no longer need it.`, severity: "low", source: "Subscriptions", url: s.url ?? "/money#spend", createdAt: now, business: s.business ?? undefined });
    } else if (!s.autoRenew && days <= 14) {
      add("subscriptions", `${s.id}:${next}`, { title: days < 0 ? `${s.vendor} expired ${relativeDays(days)}` : `${s.vendor} expires ${relativeDays(days)}`, detail: `${cost}. Auto-renew is off: renew it, or mark it inactive if you're done with it.`, severity: days < 0 ? "critical" : "high", source: "Subscriptions", url: s.url ?? "/money#spend", createdAt: now, business: s.business ?? undefined });
    }
  }

  // ─── Compliance calendar ───
  for (const d of r.records.deadlines) {
    if (d.completedOn) continue;
    const days = daysBetween(r.today, d.dueOn);
    const severity = deadlineSeverity(days, d.remindDays);
    if (!severity) continue;
    add("deadlines", `${d.id}:${d.dueOn}`, { title: d.title, detail: `${d.category === "other" ? "Deadline" : d.category[0].toUpperCase() + d.category.slice(1)} · due ${formatDate(d.dueOn)} (${relativeDays(days)})${d.recurrence !== "none" ? ` · repeats ${d.recurrence}` : ""}`, severity, source: "Deadlines", url: d.url ?? "/deadlines", createdAt: `${d.dueOn}T00:00:00.000Z`, business: d.business ?? undefined });
  }

  // ─── Account 2FA checklist ───
  // Whether a platform is in use is only known when it answered (live) or is
  // definitely not connected (demo with readable credentials). An erroring
  // platform, or credentials we couldn't read, leave the item as it was.
  for (const item of ACCOUNT_CHECKLIST) {
    const mode = r.modes[item.usedWhen as RiskScope];
    if (mode === "error" || (mode === "demo" && r.credentialsKnown === false)) {
      unobserved.push(`checklist/${item.id}`);
      continue;
    }
    if (mode !== "live") continue;
    const confirmed = r.records.checklist[item.id];
    if (confirmed && daysBetween(confirmed.slice(0, 10), r.today) < CONFIRMATION_VALID_DAYS) continue;
    add("checklist", item.id, { title: `Confirm two-factor sign-in is on for ${item.name}`, detail: confirmed ? "Last confirmed over a year ago." : "Then tick it off on the Security page.", severity: "low", source: "Security checklist", url: "/security#checklist", createdAt: now });
  }

  // ─── Domains ───
  for (const c of r.domains.checks) {
    const apex = registrableDomain(c.domain);
    const business = businessForDomain(c.domain, r.sites);
    if (c.registration.ok && c.registration.expiresOn) {
      const days = daysBetween(r.today, c.registration.expiresOn);
      const sev = registrationSeverity(days);
      if (sev) add("domains", `registration:${apex}`, { title: days < 0 ? `${apex} registration expired` : `${apex} registration expires ${relativeDays(days)}`, detail: `${c.registration.registrar ?? "Registrar unknown"} · ${formatDate(c.registration.expiresOn)}. Turn on auto-renew or renew now.`, severity: sev, source: "Domains", url: "/domains", createdAt: now, business });
    } else if (!c.registration.ok) unobserved.push(`domains/registration:${apex}`);

    if (c.certificate.ok && c.certificate.valid === false && c.certificate.problem === CHAIN_PROBLEM && daysBetween(r.today, c.certificate.expiresOn) >= 0) {
      // Desktop browsers usually fetch a missing intermediate themselves; apps, curl and some phones don't.
      add("domains", `certificate:${c.domain}`, { title: `SSL certificate chain for ${c.domain} is incomplete`, detail: `Some browsers and apps will reject it. Re-issue the certificate or include the intermediate certificate in your host's settings. (${c.certificate.issuer ?? "Unknown issuer"})`, severity: "high", source: "Domains", url: `https://${c.domain}`, createdAt: now, business });
    } else if (c.certificate.ok && c.certificate.valid === false) {
      const expired = daysBetween(r.today, c.certificate.expiresOn) < 0;
      add("domains", `certificate:${c.domain}`, { title: expired ? `SSL certificate for ${c.domain} expired` : `SSL certificate for ${c.domain} is invalid: ${c.certificate.problem ?? "not trusted"}`, detail: `${c.certificate.issuer ?? "Unknown issuer"} · expires ${formatDate(c.certificate.expiresOn)}. Visitors see a security warning; fix it in your host's domain settings.`, severity: "critical", source: "Domains", url: `https://${c.domain}`, createdAt: now, business });
    } else if (c.certificate.ok) {
      const days = daysBetween(r.today, c.certificate.expiresOn);
      const sev = certificateSeverity(days);
      if (sev) add("domains", `certificate:${c.domain}`, { title: days < 0 ? `SSL certificate for ${c.domain} expired` : `SSL certificate for ${c.domain} expires ${relativeDays(days)}`, detail: `${c.certificate.issuer ?? "Unknown issuer"}. Automatic renewal may be failing; check your host's domain settings.`, severity: sev, source: "Domains", url: `https://${c.domain}`, createdAt: now, business });
    } else unobserved.push(`domains/certificate:${c.domain}`);

    if (c.email.ok) {
      if (c.email.mx.length) {
        if (!c.email.spf) add("domains", `spf:${apex}`, { title: `Add an SPF record for ${apex}`, detail: "Without SPF, mail from this domain is likely to land in spam or be spoofed.", severity: "high", source: "Email health", url: "/domains", createdAt: now, business });
        if (!c.email.dmarc) add("domains", `dmarc:${apex}`, { title: `Add a DMARC record for ${apex}`, detail: 'Start with "v=DMARC1; p=none; rua=mailto:you@…" to see who sends as you.', severity: "medium", source: "Email health", url: "/domains", createdAt: now, business });
        else if (c.email.dmarcPolicy === "none") add("domains", `dmarc-none:${apex}`, { title: `Tighten the DMARC policy for ${apex}`, detail: "p=none only monitors. Move to p=quarantine once your reports look clean.", severity: "low", source: "Email health", url: "/domains", createdAt: now, business });
        if (!c.email.dkim.length) add("domains", `dkim:${apex}`, { title: `No DKIM key found for ${apex}`, detail: "Turn on DKIM signing with your mail provider, or add its selector on the Domains page.", severity: "low", source: "Email health", url: "/domains", createdAt: now, business });
      }
    } else unobserved.push(...["spf", "dmarc", "dmarc-none", "dkim"].map((k) => `domains/${k}:${apex}`));
  }
  for (const d of r.domains.pending) {
    const apex = registrableDomain(d);
    unobserved.push(`domains/registration:${apex}`, `domains/certificate:${d}`, ...["spf", "dmarc", "dmarc-none", "dkim"].map((k) => `domains/${k}:${apex}`));
  }

  // ─── Security ───
  if (r.security.github2fa === false) {
    add("security", "github-2fa", { title: `Turn on two-factor sign-in for GitHub (${r.security.githubLogin})`, detail: "Your code and every connected deploy hang off this account.", severity: "critical", source: "Security", url: "https://github.com/settings/security", createdAt: now });
  }
  for (const a of r.security.alerts) {
    if (a.kind === "dependabot" && a.severity !== "critical" && a.severity !== "high") continue;
    const alias = a.kind === "dependabot" ? `github-dependabot:${a.repo}:${a.number}` : `github-secret:${a.repo}:${a.number}`;
    add("security", `${a.repo}/${a.kind}:${a.number}`, { title: a.kind === "secret" ? secretTaskTitle(a) : `${a.repo}: ${a.title}`, ...(a.kind === "secret" && a.location ? { detail: `First found in ${a.location}` } : {}), severity: a.severity, source: "GitHub security", url: a.url, createdAt: a.createdAt }, alias);
  }
  for (const s of r.security.repos) {
    if (s.dependabot === "off") add("security", `${s.repo}/dependabot-off`, { title: `Turn on Dependabot alerts for ${s.repo}`, detail: "Free, and tells you when a dependency has a known vulnerability.", severity: "low", source: "Security", url: `https://github.com/${s.repo}/settings/security_analysis`, createdAt: now });
  }
  // Repos not checked this round (beyond the per-run cap, or failed) keep their tasks.
  const checked = new Set(r.security.repos.filter((s) => !r.partial.security.some((k) => k.endsWith(`:${s.repo}`))).map((s) => s.repo));
  for (const repo of r.repos) if (!checked.has(repo)) unobserved.push(`security/${repo}/`);
  for (const k of r.partial.security) {
    const [kind, repo] = [k.slice(0, k.indexOf(":")), k.slice(k.indexOf(":") + 1)];
    unobserved.push(kind === "secret" ? `security/${repo}/secret:` : `security/${repo}/dependabot`);
  }

  return { tasks, unobserved };
}

/**
 * A leaked-secret task title. Several alerts of one type in one repo (three
 * Google API keys…) are told apart by GitHub's alert number and, when known,
 * the file it was first found in.
 */
export function secretTaskTitle(a: { repo: string; title: string; number: number; location?: string }): string {
  const where = a.location ? `, ${a.location.replace(/:\d+$/, "").split("/").slice(-2).join("/")}` : "";
  return `Rotate the ${a.title.replace(/^Leaked /, "")} leaked in ${a.repo} (alert #${a.number}${where})`;
}
