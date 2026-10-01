# Kaj Command Center: proposal

**Goal:** one private place where you open your laptop or phone in the morning and know, in under a minute, what is on fire, what is waiting on you, and how every business is doing, without logging into ten platforms.

This document covers what exists today (v0.1, in this repo), where it should go, and what I need from you to get there.

---

## 1. Where we are: v0.1 (built)

A working Next.js app, deployable to Vercel, protected by a password.

- **Overview**: critical/high counts, top to-dos, latest notifications, a card per business.
- **To-do ranked by severity**: generated automatically from every source (failed deploys, sites down, database security findings, urgent emails, open PRs…).
- **Unified inbox**: several Gmail accounts in one list, each message auto-tagged critical/high/medium/low.
- **Notifications feed**: email, GitHub and deploy events together.
- **Websites & users**: live uptime and response time, plus registered users and new sign-ups from each site's Supabase.
- **Repositories** (GitHub), **Hosting** (Vercel, Cloudflare Workers), **Databases** (Supabase with security/performance advisors, Cloudflare D1).
- **Platforms page**: what's connected, what's broken and why, what's planned.
- Every connector works on its own: missing keys show demo data, broken keys show an error and create a "fix this" task.

**Limits of v0.1:** it is read-only, keeps no history, and only knows what it fetched in the last 2 minutes. Phase 1 fixes that.

---

## 2. Principles

1. **Severity first.** Everything feeds one ranked list. If something can cost money, data or reputation, it's critical and it goes at the top.
2. **Business-aware.** Every repo, site, database, mailbox and dollar is tagged to a business, so you can look at one company or all of them.
3. **Act, not just look.** Over time every to-do gets a button that resolves it (redeploy, reply, renew, restore).
4. **Push when it matters, quiet otherwise.** Critical items reach your phone. Everything else waits for you to open the dashboard or read the morning brief.
5. **Secure by default.** It holds the keys to every business, so it gets stronger auth, encrypted credentials and an audit log before it gets more power.

---

## 3. Roadmap

### Phase 1: Foundation (≈ 1–2 weeks)
*Gives the dashboard memory and real-time updates.*

| Item | Why |
|---|---|
| **Its own Supabase database** | Store tasks, notification history, snapshots and settings |
| **Task actions**: done, snooze, assign a business, add manual tasks | Today the list regenerates every load; you need to be able to clear things |
| **Webhooks** from GitHub, Vercel, Stripe, Supabase | Events arrive in seconds instead of on the next refresh |
| **Scheduled checks** (Vercel Cron, every 5 min) | Uptime and expiries get checked even when the dashboard is closed |
| **Proper login**: Google sign-in or passkey plus 2FA, replacing the shared password | Same reason a bank doesn't use one shared password |
| **Connect from the UI**: OAuth "Connect Gmail / GitHub / Vercel" buttons, tokens encrypted at rest | No more pasting tokens into environment variables |

### Phase 2: Money & risk (≈ 2 weeks)
*The things that cost money when they're missed.*

- **Stripe** (or your payment provider): revenue per business, MRR, failed payments, **disputes as critical tasks** with the deadline.
- **Accounting** (QuickBooks / Wave / Xero): unpaid invoices, overdue receivables, cash per business.
- **Subscription tracker**: every SaaS bill (Vercel, Supabase, Google Workspace, domains…) with monthly cost per business and renewal dates.
- **Domains & SSL**: expiry dates for every domain and certificate. 30/14/3-day warnings escalate low → high → critical.
- **Email health**: SPF/DKIM/DMARC checks per domain, so client emails don't land in spam.
- **Security center**: Dependabot alerts, GitHub secret scanning, Supabase RLS gaps, 2FA status on each platform.
- **Compliance calendar**: tax deadlines, annual filings, license and insurance renewals, all as dated tasks.

### Phase 3: Growth & clients (≈ 2–3 weeks)
*The good news, not just the problems.*

- **Analytics**: Google Analytics / Vercel Analytics visitors, top pages and conversions per site. Search Console for SEO.
- **Users per site**: sign-up trends over time, active users, churn, with charts from stored snapshots.
- **Clients & pipeline**: leads, proposals sent, contracts, next steps. Starts as a simple table and can link to a CRM (HubSpot, Pipedrive) later.
- **Calendar**: today's meetings from Google or Outlook next to the to-dos.
- **Reputation**: Google Business Profile reviews and LinkedIn page activity in the notification feed.
- **Microsoft 365 / Outlook** inbox next to Gmail.

### Phase 4: Intelligence & action (ongoing)
*The dashboard starts working for you.*

- **Morning brief**: a 7:00 email or push: "3 critical, revenue yesterday $X, 2 new clients signed up, domain Y expires Friday".
- **Ask the dashboard** (Claude): "Which client hasn't paid?", "What broke this week?", "Summarize the ClientCo thread".
- **AI email triage**: replace the keyword rules with a model that reads the email, sets severity, drafts a reply and creates the task.
- **One-click fixes**: redeploy or roll back a Vercel project, restore a paused Supabase project, renew a domain, open a GitHub issue from any task.
- **Weekly report per business**: PDF or email with revenue, users, uptime, issues closed. Ready to forward to a partner or accountant.
- **Mobile app (PWA)**: installable on your phone, push notifications for critical items only.

### Phase 5: Team-ready (when you hire)
- Multiple users with roles (owner, developer, assistant, accountant), each seeing only their businesses.
- Assign tasks to people, with an activity log of who did what.
- Optional read-only **client view**: a page per client showing their site's uptime and project status.

---

## 4. Architecture as it grows

```
            ┌─────────── Webhooks (GitHub, Vercel, Stripe…) ───────────┐
            ▼                                                           │
 Platforms ──► Connectors ──► Normalizer ──► Supabase (tasks, events, ──┘
 (APIs)        (one per        (shared         snapshots, settings)
               platform)        types)               │
                    ▲                                ▼
               Vercel Cron                 Next.js dashboard ──► Push / email brief
               (every 5 min)                         │
                                                     ▼
                                          Claude: triage, Q&A, drafts
```

- **Today:** the dashboard calls each API when you open it and caches the result for 2 minutes. Stateless, no database.
- **Phase 1+:** cron jobs and webhooks write into Supabase. The dashboard reads from its own database, so it's instant, has history, and shows events that happened while it was closed.
- The connector pattern already in the code (`src/lib/connectors/*`) stays. Each new platform is one file.

---

## 5. Security plan

| Now (v0.1) | Phase 1 |
|---|---|
| One password, hashed session cookie, production won't run without it | Google sign-in or passkeys, 2FA required |
| API tokens in Vercel env vars | OAuth tokens encrypted in the database, read-only scopes wherever they exist |
| Read-only access to every platform | Write actions (redeploy, reply) need a confirmation and are recorded in an audit log |
| Not indexed by search engines | Optional IP or Cloudflare Access protection in front |

---

## 6. Rough running cost

| Item | Approx. monthly |
|---|---|
| Vercel Pro (Hobby is non-commercial only) | $20 |
| Supabase (the free tier covers the dashboard's own data; Pro for backups) | $0–25 |
| Claude API for triage, brief and Q&A | $5–30 depending on email volume |
| **Total** | **≈ $25–75** |

---

## 7. What I need from you

1. **Your businesses**: names, plus which repos, domains and Supabase projects belong to each. This fills `BUSINESS_MAP` and `WEBSITES`.
2. **Mailboxes**: which Gmail and/or Outlook accounts to include.
3. **Payments & accounting**: Stripe? PayPal? QuickBooks? Wave?
4. **Domain registrar(s)**: Namecheap, GoDaddy, Cloudflare, Google?
5. **Who uses it**: just you, or partners and staff later? This decides how soon Phase 5 matters.
6. **Your priority**: which phase matters most right now? My recommendation is **Phase 1, then Phase 2**: memory and alerts first, then the money and risk items, because those are the ones that cost you when they're missed.

### Getting v0.1 live today
1. Import the repo into Vercel.
2. Set `DASHBOARD_PASSWORD`, then add whichever tokens you have (`.env.example` explains each).
3. Open the **Platforms** page and confirm each connector shows **live**.
