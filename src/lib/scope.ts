import { canSee, canSeeTask, eventSection, inBusiness, isFullOwner, ownItem, type Access, type Section } from "./access";
import type { PersonalProblem } from "./connectors/personal";
import type { SourceMode } from "./types";
import type { Bills } from "./billing/types";
import { scopeBills, type SpendChoices } from "./billing/spend";
import type { Records } from "./connectors/records";
import type { CameraSiteStatus } from "./connectors/hikvision";
import type { DomainsReport } from "./connectors/records";
import type { SolarStation } from "./solar";
import type { CalendarEvent, Database, EmailMessage, HostingProject, Notification, PlaceReviews, Repo, SecurityReport, SiteAnalytics, StripeAccountSummary, Task, Website } from "./types";

// Cuts the dashboard down to what one person may see: sections their role
// doesn't include come back empty, and rows from businesses they don't have
// are dropped. Pages, Ask and notifications all read the scoped copy, so
// nothing has to remember to filter on its own.

export interface ScopableTask extends Task {
  sourceKey?: string | null;
  assignee?: string | null;
}

// Personal items (someone's own mailbox and calendar, and what's derived from
// them) carry an owner and reach that person alone. That holds for every
// viewer, full owners included, and is applied before anything else, so the
// shared cache of platform data can hold everyone's items safely.

export interface Scopable {
  repos: Repo[];
  hosting: HostingProject[];
  databases: Database[];
  emails: EmailMessage[];
  websites: Website[];
  stripe: StripeAccountSummary[];
  records: Records;
  domains: DomainsReport;
  security: SecurityReport;
  calendar: CalendarEvent[];
  analytics: SiteAnalytics[];
  reviews: PlaceReviews[];
  cameras: CameraSiteStatus[];
  solar: SolarStation[];
  notifications: Notification[];
  openTasks: ScopableTask[];
  derivedTasks: Task[];
  platforms: unknown[];
  sources: { source: string; mode: string; error?: string; partial?: { key: string; error: string }[] }[];
  undecryptableConnections: number;
  personalProblems?: PersonalProblem[];
  /** People with a personal mailbox being read. */
  personalOwners?: string[];
  modes?: Record<string, SourceMode>;
  /** Automatic bills (billing APIs, detected e-mails); see scopeBills. */
  bills?: Bills;
  spendChoices?: SpendChoices;
}

export interface ScopeContext {
  /** Business of a website / domain, from the Websites settings. */
  businessForDomain: (domain: string) => string | undefined;
}

/** Drops other people's personal items. Every viewer goes through this, full owners included. */
export function privateFor<T extends Scopable>(d: T, a: Access, email: string): T {
  const own = ownItem(email);
  // The shared Inbox / Agenda modes ignore personal mailboxes; a person whose
  // own mailbox is read sees those pages as live. Sample data (shared mode
  // not live) is then dropped from their copy rather than mixed with real mail.
  const mine = !!d.modes && d.modes.mymail === "live" && !!d.personalOwners?.includes(email);
  const upgrade = (k: "inbox" | "calendar") => mine && d.modes![k] !== "live";
  const emails = d.emails.filter(upgrade("inbox") ? (x) => x.owner === email : own);
  const calendar = d.calendar.filter(upgrade("calendar") ? (x) => x.owner === email : own);
  return {
    ...d,
    ...(d.modes ? { modes: { ...d.modes, ...(upgrade("inbox") ? { inbox: "live" } : {}), ...(upgrade("calendar") ? { calendar: "live" } : {}) } } : {}),
    ...(d.personalOwners ? { personalOwners: d.personalOwners.filter((o) => o === email) } : {}),
    emails,
    calendar,
    notifications: d.notifications.filter(own),
    openTasks: d.openTasks.filter((t) => !t.privateTo || canSeeTask(a, email, t)),
    derivedTasks: d.derivedTasks.filter((t) => !t.privateTo || t.privateTo === email),
    ...(d.personalProblems ? { personalProblems: d.personalProblems.filter((p) => p.owner === email) } : {}),
  };
}

export function scopeFor<T extends Scopable>(full: T, a: Access, email: string, ctx: ScopeContext): T {
  const d = privateFor(full, a, email);
  if (isFullOwner(a)) return d;
  const sec = (s: Section) => canSee(a, s);
  const biz = (b: string | null | undefined) => inBusiness(a, b);
  const pick = <X>(s: Section, list: X[], business: (x: X) => string | null | undefined): X[] => (sec(s) ? list.filter((x) => biz(business(x))) : []);
  const repoBusiness = new Map(d.repos.map((r) => [r.fullName, r.business]));
  const domainBiz = (domain: string) => ctx.businessForDomain(domain);

  const repos = pick("repos", d.repos, (r) => r.business);
  const visibleRepos = new Set(repos.map((r) => r.fullName));
  const securityVisible = sec("security");

  return {
    ...d,
    repos,
    hosting: pick("hosting", d.hosting, (h) => h.business),
    databases: pick("databases", d.databases, (x) => x.business),
    // Members see only their own mailbox. Mailboxes the owner connected on
    // Platforms (the owner's own mail) are for full owners alone.
    emails: sec("inbox") ? d.emails.filter((e) => !!e.owner && e.owner === email) : [],
    websites: pick("websites", d.websites, (w) => w.business),
    stripe: pick("money", d.stripe, (s) => s.business),
    records: {
      ...d.records,
      invoices: pick("money", d.records.invoices, (i) => i.business),
      subscriptions: pick("money", d.records.subscriptions, (s) => s.business),
      deadlines: pick("deadlines", d.records.deadlines, (x) => x.business),
      clients: pick("clients", d.records.clients, (c) => c.business),
      deals: pick("clients", d.records.deals, (x) => x.business),
      // The account checklist is about the owner's own logins.
      checklist: {},
    },
    domains: sec("domains") ? { checks: d.domains.checks.filter((c) => biz(domainBiz(c.domain))), pending: d.domains.pending.filter((p) => biz(domainBiz(p))) } : { checks: [], pending: [] },
    security: securityVisible
      ? { alerts: d.security.alerts.filter((x) => biz(repoBusiness.get(x.repo)) && (visibleRepos.has(x.repo) || !sec("repos"))), repos: d.security.repos.filter((x) => biz(repoBusiness.get(x.repo))), github2fa: null, githubLogin: null }
      : { alerts: [], repos: [], github2fa: null, githubLogin: null },
    // Members see only their own calendar; the owner's calendars stay with full owners.
    calendar: sec("agenda") ? d.calendar.filter((x) => !!x.owner && x.owner === email) : [],
    analytics: pick("analytics", d.analytics, (x) => domainBiz(x.domain)),
    reviews: pick("analytics", d.reviews, (p) => p.business),
    ...(d.bills ? { bills: scopeBills(d.bills, a) } : {}),
    cameras: pick("cameras", d.cameras, (s) => s.business),
    solar: pick("solar", d.solar, (s) => s.business),
    notifications: d.notifications.filter((n) => {
      const s = eventSection(n.source);
      if (n.owner) return n.owner === email && (s === "notifications" ? sec("notifications") : sec(s));
      // Events from the owner's mailboxes are the owner's mail: never shown to members.
      if (s === "inbox" || s === "agenda") return false;
      return (s === "notifications" ? sec("notifications") : sec(s)) && biz(n.business);
    }),
    openTasks: d.openTasks.filter((t) => canSeeTask(a, email, t)),
    derivedTasks: [],
    platforms: [],
    // Connector errors name accounts and platforms: owners only.
    sources: d.sources.map((s) => ({ source: s.source, mode: s.mode })),
    undecryptableConnections: 0,
  };
}
