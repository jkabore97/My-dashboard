# Kaj Command Center

One private dashboard for every business Kaj Consulting runs: repositories, hosting, databases, email, websites and their users — with everything that needs attention pulled into a single to-do list ranked by severity.

![Overview](docs/overview.png)

## What's in it

| Section | Source | What you see |
|---|---|---|
| **Overview** | everything | Critical/high counts, top to-dos, latest notifications, a card per business |
| **To-do** | derived | One list ranked **critical → high → medium → low**, filterable by business |
| **Inbox** | Gmail (multi-account) | Last 14 days from every mailbox, auto-triaged by urgency |
| **Notifications** | Gmail, GitHub, Vercel, Cloudflare | Unified feed, newest first |
| **Websites & users** | uptime probe + Supabase auth | Up/down, response time, registered users, new sign-ups |
| **Repositories** | GitHub | Every active repo, open PRs and issues, last push |
| **Hosting** | Vercel, Cloudflare Workers | Latest production deploy status per project |
| **Databases** | Supabase, Cloudflare D1 | Health, region, security & performance advisor findings |
| **Platforms** | — | Which integrations are live, demo, broken or planned |

### How the to-do list ranks things

| Severity | Generated when |
|---|---|
| Critical | A site is down · a production deploy failed · a database is unhealthy · a Supabase security advisor reports an error · an email mentions a dispute, chargeback, security alert, suspension or failed payment |
| High | A site is slow or erroring · a connector is broken · an email says failed, expiring, overdue, vulnerability, action required |
| Medium | Open PRs to review · 10+ open issues · advisor warnings · unread mail from a real person |
| Low | Paused databases · repos with open work but no push in 30 days |

Rules live in `src/lib/aggregate.ts` (`deriveTasks`) and `src/lib/connectors/gmail.ts` (`classifyEmail`).

## Run it

```bash
npm install
cp .env.example .env.local   # fill in what you have; leave the rest blank
npm run dev                  # http://localhost:3000
```

With no keys set it runs on demo data. Each connector switches to live data independently as soon as its keys exist. A connector whose keys are set but failing shows as **error** with the reason, and a "fix the connection" task appears.

## Deploy (Vercel)

1. Import this repo in Vercel.
2. Add the variables from `.env.example`. **`DASHBOARD_PASSWORD` is required** — production refuses to serve without it.
3. Deploy. Data is fetched per request and cached for 2 minutes per source.

## Adding a platform

1. Write `src/lib/connectors/<name>.ts` that returns one of the shared types in `src/lib/types.ts` via `fromSource(...)`.
2. Call it from `getSnapshot()` in `src/lib/aggregate.ts` and add any task rules to `deriveTasks`.
3. Flip `available: true` for it in `src/lib/platforms.ts`.

See **[PROPOSAL.md](PROPOSAL.md)** for the roadmap.
