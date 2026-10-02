# Connecting everything: step by step

Your dashboard: **https://kaj-command-center.vercel.app**. Sample data is off, so each section stays empty until its platform is connected. Do the steps in order; each takes 2–10 minutes. Sign in first (Microsoft + authenticator app).

"Vercel settings" below means: vercel.com → **kaj-command-center** → **Settings → Environment Variables**. After adding or changing one there, open **Deployments**, click the **⋯** on the newest one and choose **Redeploy** (or ask Claude to redeploy).

---

## 1. Your businesses and websites (in the dashboard)

**Settings → Businesses**, one rule per line, `name fragment = Business`. Anything (repo, project, database) whose name contains the fragment is grouped under that business:

```
kaj = Kaj Consulting
shipping = Kaj Shipping
```

**Settings → Websites**, one site per line, `domain | Business | Supabase project ref (optional)`:

```
kaj-consulting.com | Kaj Consulting
kajshipping.com | Kaj Shipping | abcdefghijklmnopqrst
```

Sites are checked for uptime, and their domains for expiry, SSL and email setup, automatically.

## 2. GitHub (repos, pull requests, CI, security alerts)

1. github.com → your photo → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. Resource owner: your account (or organization). Repository access: **All repositories**.
3. Repository permissions, all **Read-only**: Metadata, Contents, Issues, Pull requests, Actions, Dependabot alerts, Secret scanning alerts. Add **Actions: Read and write** if you want the "Re-run failed jobs" button.
4. Dashboard → **Platforms → GitHub → Use an API token instead** → paste → Connect.

## 3. Vercel (projects and deploys)

1. vercel.com → your avatar → **Account Settings → Tokens → Create**. Scope: your team. Expiry: as you like.
2. Team ID: vercel.com → team **Settings → General → Team ID** (starts with `team_`).
3. Dashboard → **Platforms → Vercel → Use an API token instead** → paste the token and the Team ID.

## 4. Supabase (projects, security advisors, sign-ups)

1. supabase.com → your avatar → **Account preferences → Access Tokens → Generate new token**.
2. Dashboard → **Platforms → Supabase → Connect with an API key** → paste.
3. To count a website's sign-ups, add its project ref (Project Settings → General) to that site's line in Settings → Websites.

## 5. Cloudflare (Workers, D1 databases) — skip if you don't use them

1. dash.cloudflare.com → **My Profile → API Tokens → Create Token → Custom token**. Permissions: Account Settings: Read, Workers Scripts: Read, D1: Read.
2. Account ID: right-hand side of any domain's Overview page.
3. Dashboard → **Platforms → Cloudflare** → paste both.

## 6. Outlook mail and calendar (Microsoft 365)

Uses the same Microsoft app you already made for sign-in.

1. entra.microsoft.com → **App registrations → your app → Authentication → Add URI**:
   `https://kaj-command-center.vercel.app/api/connect/microsoft/callback` → Save.
2. **API permissions → Add a permission → Microsoft Graph → Delegated**: `offline_access`, `User.Read`, `Mail.Read`, `Calendars.Read` → Add. Then **Grant admin consent**.
3. Dashboard → **Platforms → Microsoft 365 → Connect**, sign in with each mailbox you want (one at a time).

## 7. Google (Gmail, Calendar, Analytics, Search Console) — if you use Google accounts

1. console.cloud.google.com → create a project ("Kaj Command Center").
2. **APIs & Services → Library**, enable: Gmail API, Google Calendar API, Google Analytics Data API, Google Analytics Admin API, Google Search Console API.
3. **OAuth consent screen**: External, app name, your email. Add yourself (and each Google account you'll connect) as a **test user**.
4. **Credentials → Create credentials → OAuth client ID → Web application**. Authorized redirect URI:
   `https://kaj-command-center.vercel.app/api/connect/gmail/callback`
5. Vercel settings: add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (Production), then redeploy.
6. Dashboard → **Platforms → Google → Connect** for each Google account.

Google sign-in to the dashboard stays off; this only reads mail, calendar and analytics.

## 8. Stripe (revenue, MRR, disputes, unpaid invoices)

For each Stripe account (one per business):

1. dashboard.stripe.com → **Developers → API keys → Create restricted key**. Read access: Balance, Charges, Disputes, Invoices, Subscriptions, Customers, Accounts (everything else: None).
2. Dashboard → **Platforms → Stripe** → paste the `rk_live_…` key and the business name.

## 9. Real-time alerts (webhooks) — optional, makes alerts instant

On **Platforms → Real-time webhooks**, each card shows the URL to give the platform:

- **GitHub**: repo or org → Settings → Webhooks → Add. Paste the URL, content type `application/json`, click **Generate** on the dashboard card and paste that secret. Events: Workflow runs, Pull requests, Issues, Dependabot alerts, Secret scanning alerts.
- **Vercel**: team Settings → Webhooks → paste URL; copy Vercel's secret into the dashboard card.
- **Stripe**: Developers → Webhooks → Add endpoint → paste URL; copy the `whsec_…` secret into the dashboard card.

## 10. Google reviews — optional

1. In the Google Cloud project from step 7: enable **Places API (New)**, then **Credentials → Create API key**, restrict it to Places API.
2. Vercel settings: `GOOGLE_PLACES_API_KEY`, then redeploy.
3. Dashboard → **Settings → Google Business listings**: `place ID | Business` per line (find IDs with Google's "Place ID Finder").

## 11. Cameras (Hikvision)

Follow the README section **Cameras (Hikvision)**: Cloudflare Tunnel to the NVR, a view-only NVR user, then **Platforms → Hikvision cameras → Add a recorder site**.

## 12. Solar (SOFAR)

**Settings → Solar → Create ingest token**, then the Home Assistant config in the README section **Solar**. Ask SOFAR support for Fsolar API access for a direct link later.

## 13. Notifications on your phone

Push is already configured on the server (VAPID keys). On your phone, open the dashboard, **Share → Add to Home Screen** (iPhone) or **Install app** (Android), open it from there, then **Settings → Notifications → Enable on this device → Send a test**. Do the same on your computer's browser if you want alerts there too. Each team member does this on their own devices.

What arrives (only alerts the person is allowed to see: their role's sections and businesses, or tasks assigned to them):

- **Critical**: at once, always, even at night or when paused.
- **High**: at once; during quiet hours (default 10 PM–7 AM in *your* time zone) or a pause, held until they end.
- **Medium**: one **noon digest** push at 12:00 your time.
- **Low**: no push; it's in the morning brief.
- **Resolved**: when a critical/high alert you got clears, a short "Resolved" replaces it (skipped in quiet hours).
- Website outages are pushed only if the site is still down on a second check ≥4 minutes later. More than 5 pushes in 10 minutes are combined into one.

**Settings → Notifications** sets your quiet hours and time zone (America/New_York and Africa/Ouagadougou are at the top), turns High alerts / Noon digest / Resolved messages on or off, and pauses non-critical pushes for 1 h, 4 h or until 7 AM. On Android and desktop, a notification has **Acknowledge** and **Snooze 1h** buttons; on iPhone, tap it to open the dashboard. The **bell** at the top of every page lists your latest notifications; **Alerts → Delivery log** shows what was sent, held or skipped and why (the owner sees everyone's).

## 13b. Instant alerts every 5 minutes (free scheduler)

Vercel's free plan runs the dashboard's own check once a day. Without this step, alerts still arrive at once for webhooks (step 9) and whenever someone opens the dashboard, but a website going down at night would wait. To check every 5 minutes, for free:

1. Dashboard → **Settings → Notifications → Instant alerts every 5 minutes → Create scheduler link**. Copy the link now (it's shown once; only a fingerprint of it is stored).
2. Sign up at **cron-job.org** (free) → **Cronjobs → Create cronjob**.
3. **URL**: paste the link. **Execution schedule**: every 5 minutes. Method GET.
4. **Advanced**: timeout 60 seconds. Optionally turn on "notify me when the job fails". **Create**.
5. After ~10 minutes, the Settings panel shows *Running · last call N minutes ago*.

Keep the link private: it can only trigger a check, nothing else. **Replace scheduler link** makes a new one and stops the old one (update cron-job.org afterwards). Schedulers that can send headers may call `https://kaj-command-center.vercel.app/api/tick` with `Authorization: Bearer <CRON_SECRET>` instead.

## 14. Morning brief and weekly reports by email — optional

1. resend.com → sign up → **Domains → Add** `kaj-consulting.com` and add the DNS records it shows.
2. **API Keys → Create**.
3. Vercel settings: `RESEND_API_KEY`, `BRIEF_EMAIL_FROM` = `Command Center <brief@kaj-consulting.com>`, `BRIEF_EMAIL_TO` = `hello@kaj-consulting.com`, then redeploy.

## 15. AI (inbox triage, reply drafts, Ask) — optional

console.anthropic.com → **API Keys → Create** → Vercel settings: `ANTHROPIC_API_KEY`, then redeploy. Typical cost $5–30/month.

## 16. Invite your team

**Team → Invite**: their Microsoft sign-in address, a role and their businesses. They open the site and choose **Sign in with Microsoft**.
