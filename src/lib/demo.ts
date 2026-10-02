// Sample data shown until real credentials are configured. Timestamps are
// relative to "now" so the demo always looks current.
import type { DomainCheck } from "./server/domains";
import type { CalendarEvent, Database, EmailMessage, HostingProject, PlaceReviews, Repo, SecurityReport, SiteAnalytics, StripeAccountSummary, Task, Website } from "./types";

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

export const demoRepos = (): Repo[] => [
  { id: "r1", name: "my-dashboard", fullName: "jkabore97/my-dashboard", url: "https://github.com/jkabore97/my-dashboard", private: true, language: "TypeScript", defaultBranch: "main", openIssues: 2, openPullRequests: 1, pushedAt: ago(12), business: "Kaj Consulting" },
  { id: "r2", name: "kaj-consulting-site", fullName: "kaj/kaj-consulting-site", url: "https://github.com", private: false, language: "TypeScript", defaultBranch: "main", openIssues: 5, openPullRequests: 3, pushedAt: ago(60 * 5), business: "Kaj Consulting" },
  { id: "r3", name: "client-portal", fullName: "kaj/client-portal", url: "https://github.com", private: true, language: "TypeScript", defaultBranch: "main", openIssues: 11, openPullRequests: 0, pushedAt: ago(60 * 26), business: "Kaj Consulting" },
  { id: "r4", name: "shop-storefront", fullName: "kaj/shop-storefront", url: "https://github.com", private: true, language: "JavaScript", defaultBranch: "main", openIssues: 1, openPullRequests: 2, pushedAt: ago(60 * 24 * 3), business: "Kaj Store" },
  { id: "r5", name: "booking-api", fullName: "kaj/booking-api", url: "https://github.com", private: true, language: "Python", defaultBranch: "main", openIssues: 0, openPullRequests: 0, pushedAt: ago(60 * 24 * 40), business: "Kaj Bookings" },
];

export const demoHosting = (): HostingProject[] => [
  { id: "h1", name: "kaj-consulting-site", provider: "vercel", url: "https://kajconsulting.example", framework: "nextjs", lastDeployState: "ready", lastDeployAt: ago(300), repo: "kaj-consulting-site", business: "Kaj Consulting" },
  { id: "h2", name: "client-portal", provider: "vercel", url: "https://portal.kajconsulting.example", framework: "nextjs", lastDeployState: "error", lastDeployAt: ago(95), repo: "client-portal", business: "Kaj Consulting" },
  { id: "h3", name: "shop-storefront", provider: "vercel", url: "https://shop.example", framework: "vite", lastDeployState: "building", lastDeployAt: ago(3), repo: "shop-storefront", business: "Kaj Store" },
  { id: "h4", name: "booking-worker", provider: "cloudflare", url: "https://book.example", framework: "workers", lastDeployState: "ready", lastDeployAt: ago(60 * 24 * 8), repo: "booking-api", business: "Kaj Bookings" },
];

export const demoDatabases = (): Database[] => [
  { id: "d1", name: "kaj-prod", provider: "supabase", region: "us-east-1", status: "healthy", createdAt: ago(60 * 24 * 200), business: "Kaj Consulting", advisories: [{ level: "critical", title: "RLS disabled on table public.clients" }] },
  { id: "d2", name: "shop-db", provider: "supabase", region: "eu-west-2", status: "healthy", createdAt: ago(60 * 24 * 90), business: "Kaj Store", advisories: [{ level: "medium", title: "Unindexed foreign key on orders.customer_id" }] },
  { id: "d3", name: "bookings-staging", provider: "supabase", region: "us-east-1", status: "paused", createdAt: ago(60 * 24 * 300), business: "Kaj Bookings" },
  { id: "d4", name: "booking-cache", provider: "cloudflare-d1", region: null, status: "healthy", createdAt: ago(60 * 24 * 60), business: "Kaj Bookings" },
];

export const demoEmails = (): EmailMessage[] => [
  { id: "e1", from: "Stripe <notifications@stripe.com>", subject: "Payment dispute opened: $480.00", snippet: "A customer has disputed a charge. Respond by Oct 8 to avoid losing the funds…", receivedAt: ago(40), unread: true, account: "Kaj Consulting", mailbox: "demo:Kaj Consulting", labels: ["INBOX", "IMPORTANT"], severity: "critical" },
  { id: "e2", from: "Vercel <notifications@vercel.com>", subject: "Failed production deployment on client-portal", snippet: "Build failed: Type error in app/invoices/page.tsx…", receivedAt: ago(95), unread: true, account: "Kaj Consulting", mailbox: "demo:Kaj Consulting", labels: ["INBOX"], severity: "high" },
  { id: "e3", from: "Namecheap <support@namecheap.com>", subject: "Domain shop.example expires in 9 days", snippet: "Auto-renew is off for this domain. Renew now to keep your site online…", receivedAt: ago(60 * 7), unread: true, account: "Kaj Store", mailbox: "demo:Kaj Store", labels: ["INBOX", "IMPORTANT"], severity: "high" },
  { id: "e4", from: "Ama Mensah <ama@clientco.example>", subject: "Re: Q4 proposal — next steps", snippet: "Thanks for the deck. Can we meet Thursday to finalize scope and pricing?", receivedAt: ago(60 * 9), unread: true, account: "Kaj Consulting", mailbox: "demo:Kaj Consulting", labels: ["INBOX"], severity: "medium" },
  { id: "e5", from: "GitHub <noreply@github.com>", subject: "[kaj/client-portal] Dependabot alert: next (high)", snippet: "A high severity vulnerability was found in a dependency…", receivedAt: ago(60 * 20), unread: false, account: "Kaj Consulting", mailbox: "demo:Kaj Consulting", labels: ["INBOX"], severity: "high" },
  { id: "e6", from: "Google Workspace <workspace-noreply@google.com>", subject: "Your monthly invoice is available", snippet: "Invoice for September 2026 — total $36.00.", receivedAt: ago(60 * 30), unread: false, account: "Kaj Consulting", mailbox: "demo:Kaj Consulting", labels: ["INBOX"], severity: "low" },
];

export const demoWebsites = (): Website[] => [
  { id: "w1", domain: "kajconsulting.example", business: "Kaj Consulting", status: "up", responseMs: 182, totalUsers: 0, newUsers7d: 0, visitors7d: 1240, hostingProjectId: "h1" },
  { id: "w2", domain: "portal.kajconsulting.example", business: "Kaj Consulting", status: "degraded", responseMs: 1450, totalUsers: 86, newUsers7d: 4, visitors7d: 310, hostingProjectId: "h2" },
  { id: "w3", domain: "shop.example", business: "Kaj Store", status: "up", responseMs: 240, totalUsers: 1932, newUsers7d: 57, visitors7d: 6120, hostingProjectId: "h3" },
  { id: "w4", domain: "book.example", business: "Kaj Bookings", status: "up", responseMs: 95, totalUsers: 412, newUsers7d: 12, visitors7d: 880, hostingProjectId: "h4" },
];

export const demoManualTasks = (): Task[] => [
  { id: "m1", title: "File quarterly estimated taxes", detail: "Due Oct 15", severity: "high", source: "Manual", createdAt: ago(60 * 24 * 2), business: "Kaj Consulting" },
  { id: "m2", title: "Send invoice to ClientCo for September", severity: "medium", source: "Manual", createdAt: ago(60 * 24), business: "Kaj Consulting" },
  { id: "m3", title: "Refresh portfolio case studies", severity: "low", source: "Manual", createdAt: ago(60 * 24 * 10), business: "Kaj Consulting" },
];

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

function demoDaily(base: number, currency: string) {
  return Array.from({ length: 30 }, (_, i) => ({ date: day(i - 29), currency, gross: Math.round(base * (0.55 + ((i * 37) % 10) / 10) * (i % 7 === 5 || i % 7 === 6 ? 0.4 : 1)) }));
}

export const demoStripe = (): StripeAccountSummary[] => {
  const consulting = demoDaily(42_000, "usd");
  const store = demoDaily(18_500, "usd");
  const sum = (d: { gross: number }[]) => d.reduce((n, x) => n + x.gross, 0);
  return [
    {
      id: "demo-consulting", business: "Kaj Consulting", livemode: true,
      balance: [{ currency: "usd", available: 1_284_000, pending: 312_500 }],
      revenue: [{ currency: "usd", gross: sum(consulting), refunds: 0, fees: Math.round(sum(consulting) * 0.029), net: Math.round(sum(consulting) * 0.971) }],
      daily: consulting, mrr: [{ currency: "usd", amount: 650_000 }], activeSubscriptions: 9, pastDueSubscriptions: 1,
      disputes: [{ id: "dp_demo", amount: 48_000, currency: "usd", reason: "fraudulent", status: "needs_response", dueBy: new Date(Date.now() + 6 * 86_400_000).toISOString(), created: ago(40) }],
      openInvoices: [
        { id: "in_demo1", source: "stripe", business: "Kaj Consulting", client: "ClientCo", number: "KC-0142", amount: 360_000, currency: "usd", dueOn: day(-12) },
        { id: "in_demo2", source: "stripe", business: "Kaj Consulting", client: "Northwind LLC", number: "KC-0147", amount: 125_000, currency: "usd", dueOn: day(9) },
      ],
      truncated: false,
    },
    {
      id: "demo-store", business: "Kaj Store", livemode: true,
      balance: [{ currency: "usd", available: 402_300, pending: 88_100 }],
      revenue: [{ currency: "usd", gross: sum(store), refunds: 21_900, fees: Math.round(sum(store) * 0.032), net: Math.round(sum(store) * 0.95) }],
      daily: store, mrr: [], activeSubscriptions: 0, pastDueSubscriptions: 0, disputes: [], openInvoices: [], truncated: false,
    },
  ];
};

export const demoSecurity = (): SecurityReport => ({
  githubLogin: "kaj",
  github2fa: true,
  alerts: [
    { kind: "dependabot", repo: "kaj/client-portal", number: 14, severity: "high", title: "Vulnerable next: authorization bypass in middleware", url: "https://github.com", createdAt: ago(60 * 20) },
    { kind: "dependabot", repo: "kaj/shop-storefront", number: 3, severity: "medium", title: "Vulnerable vite: dev server file read", url: "https://github.com", createdAt: ago(60 * 24 * 6) },
  ],
  repos: [
    { repo: "kaj/client-portal", dependabot: "on", secretScanning: "unavailable" },
    { repo: "kaj/kaj-consulting-site", dependabot: "on", secretScanning: "on" },
    { repo: "kaj/booking-api", dependabot: "off", secretScanning: "unavailable" },
  ],
});

export const demoDomains = (): DomainCheck[] => [
  { domain: "kajconsulting.example", checkedAt: ago(90), registration: { ok: true, expiresOn: day(212), registrar: "Namecheap, Inc." }, certificate: { ok: true, expiresOn: day(61), issuer: "Let's Encrypt" }, email: { ok: true, mx: ["aspmx.l.google.com"], spf: "v=spf1 include:_spf.google.com ~all", dmarc: "v=DMARC1; p=none; rua=mailto:dmarc@kajconsulting.example", dmarcPolicy: "none", dkim: ["google"] } },
  { domain: "shop.example", checkedAt: ago(90), registration: { ok: true, expiresOn: day(9), registrar: "Namecheap, Inc." }, certificate: { ok: true, expiresOn: day(5), issuer: "Let's Encrypt" }, email: { ok: true, mx: ["mx1.mail.example"], spf: null, dmarc: null, dmarcPolicy: null, dkim: [] } },
  { domain: "book.example", checkedAt: ago(90), registration: { ok: true, expiresOn: day(340), registrar: "Cloudflare, Inc." }, certificate: { ok: true, expiresOn: day(80), issuer: "Google Trust Services" }, email: { ok: true, mx: [], spf: null, dmarc: null, dmarcPolicy: null, dkim: [] } },
];

function series(base: number, seed: number) {
  return Array.from({ length: 28 }, (_, i) => ({ date: day(i - 27), value: Math.round(base * (0.7 + (((i + seed) * 37) % 11) / 18) * ((i + 2) % 7 >= 5 ? 0.6 : 1)) }));
}
const total = (p: { value: number }[]) => p.reduce((n, x) => n + x.value, 0);

export const demoAnalytics = (): SiteAnalytics[] =>
  [
    { domain: "kajconsulting.example", base: 170, clicks: 22, seed: 1 },
    { domain: "portal.kajconsulting.example", base: 40, clicks: 0, seed: 2 },
    { domain: "shop.example", base: 860, clicks: 140, seed: 3 },
    { domain: "book.example", base: 120, clicks: 18, seed: 4 },
  ].map(({ domain, base, clicks, seed }) => {
    const sessions = series(base, seed);
    const users = sessions.map((p) => ({ ...p, value: Math.round(p.value * 0.78) }));
    const clickSeries = series(clicks, seed + 5);
    return {
      domain,
      property: `properties/demo-${seed}`,
      traffic: {
        sessions,
        users,
        totals: { sessions: total(sessions), users: Math.round(total(users) * 0.7), newUsers: Math.round(total(users) * 0.45), keyEvents: Math.round(total(sessions) * 0.03) },
        topPages: [{ path: "/", views: Math.round(total(sessions) * 0.5) }, { path: "/services", views: Math.round(total(sessions) * 0.2) }, { path: "/contact", views: Math.round(total(sessions) * 0.08) }],
      },
      search: clicks
        ? { siteUrl: `sc-domain:${domain}`, clicks: clickSeries, totals: { clicks: total(clickSeries), impressions: total(clickSeries) * 24, ctr: 1 / 24, position: 14.2 }, topQueries: [{ query: domain.split(".")[0].replace(/-/g, " "), clicks: Math.round(total(clickSeries) * 0.4), impressions: total(clickSeries) * 3, position: 1.4 }, { query: "small business consulting", clicks: Math.round(total(clickSeries) * 0.1), impressions: total(clickSeries) * 9, position: 18.6 }] }
        : null,
    };
  });

const at = (dayOffset: number, hour: number, minute = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
};

export const demoCalendar = (): CalendarEvent[] => [
  { id: "c1", title: "ClientCo: scope review", start: at(0, 10), end: at(0, 11), allDay: false, calendar: "Kaj Consulting", provider: "google", location: null, meetingUrl: "https://meet.google.com", url: null },
  { id: "c2", title: "Accountant: quarterly taxes", start: at(0, 15, 30), end: at(0, 16), allDay: false, calendar: "Kaj Consulting", provider: "google", location: "Office", meetingUrl: null, url: null },
  { id: "c3", title: "Northwind discovery call", start: at(1, 9), end: at(1, 9, 45), allDay: false, calendar: "Kaj Consulting", provider: "microsoft", location: null, meetingUrl: "https://teams.microsoft.com", url: null },
  { id: "c4", title: "Shop photo shoot", start: day(3), end: day(4), allDay: true, calendar: "Kaj Store", provider: "google", location: null, meetingUrl: null, url: null },
];

export const demoReviews = (): PlaceReviews[] => [
  {
    placeId: "demo-consulting", business: "Kaj Consulting", name: "Kaj Consulting", rating: 4.8, reviewCount: 37, url: null,
    reviews: [
      { id: "r1", rating: 5, text: "Clear advice and fast turnaround on our new site.", author: "Ama M.", publishedAt: ago(60 * 24 * 3), relative: "3 days ago" },
      { id: "r2", rating: 2, text: "Good work but the project ran two weeks late and nobody told us.", author: "J. Ouedraogo", publishedAt: ago(60 * 24 * 6), relative: "6 days ago" },
    ],
  },
  {
    placeId: "demo-store", business: "Kaj Store", name: "Kaj Store", rating: 4.4, reviewCount: 212, url: null,
    reviews: [{ id: "r3", rating: 4, text: "Nice products, delivery could be faster.", author: "Sam K.", publishedAt: ago(60 * 24 * 12), relative: "2 weeks ago" }],
  },
];
