import { canSee, canSeeTask, eventSection, inBusiness, isFullOwner, type Access, type Section } from "./access";
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
}

export interface ScopeContext {
  /** Business of a website / domain, from the Websites settings. */
  businessForDomain: (domain: string) => string | undefined;
}

export function scopeFor<T extends Scopable>(d: T, a: Access, email: string, ctx: ScopeContext): T {
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
    emails: pick("inbox", d.emails, (e) => e.business),
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
    // Calendars aren't tied to a business: whoever has the Agenda sees them.
    calendar: sec("agenda") ? d.calendar : [],
    analytics: pick("analytics", d.analytics, (x) => domainBiz(x.domain)),
    reviews: pick("analytics", d.reviews, (p) => p.business),
    cameras: pick("cameras", d.cameras, (s) => s.business),
    solar: pick("solar", d.solar, (s) => s.business),
    notifications: d.notifications.filter((n) => {
      const s = eventSection(n.source);
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
