// Sample data shown until real credentials are configured. Timestamps are
// relative to "now" so the demo always looks current.
import type { Database, EmailMessage, HostingProject, Repo, Task, Website } from "./types";

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
