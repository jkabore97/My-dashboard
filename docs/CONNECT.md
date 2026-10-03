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

Uses the same Microsoft app you already made for sign-in. The Inbox is a full mail client: every folder, search, read, flag, archive, delete, and **reply / reply all / forward / new message** from the dashboard. That needs read **and write** access to mail plus permission to send.

1. entra.microsoft.com → **App registrations → your app → Authentication → Add URI**:
   `https://kaj-command-center.vercel.app/api/connect/microsoft/callback` → Save.
2. **API permissions → Add a permission → Microsoft Graph → Delegated permissions**, tick:
   - `offline_access`, `User.Read`, `Calendars.Read`
   - `Mail.ReadWrite`: list every folder, open messages and attachments, mark read/unread, flag, archive, delete (to Deleted Items).
   - `Mail.Send`: needed to reply, forward and send. **`Mail.ReadWrite` alone can't send**: it only lets the app create drafts.
   (`Mail.Read` can stay or be removed; `Mail.ReadWrite` includes it.)
   → **Add permissions**, then **Grant admin consent for <your organisation>** and confirm. Every permission should show a green "Granted" tick.
3. **Reconnect each mailbox** so its sign-in includes the new permissions:
   - Shared mailboxes: Dashboard → **Platforms → Microsoft 365 → Connect another account**, and sign in with the **same** mailbox again (it replaces the old sign-in; label and business are kept).
   - Personal mailboxes: each person goes to **Settings → My mail & calendar → Reconnect Microsoft**.
4. Check: under each mailbox on Platforms (and in Settings → My mail) the chips read **Read mail · Organise · Send**. A mailbox still missing one shows **Reconnect to enable replying** there and on the Inbox.

After admin consent, older mailboxes often pick up the new permissions on their next token refresh without reconnecting; if the chips still say otherwise after an hour, reconnect.

Who can do what in the Inbox:

- **Your own personal mailbox**: you alone read it, organise it and send from it. Nobody else (the owner included) can open it.
- **Shared mailboxes** (connected on Platforms): people whose access includes the Inbox and the mailbox's business can read them, mark messages read/unread and flag them. **Only full owners** (role Owner with every business) archive, delete and send from them; everyone else sees "Only the dashboard owner sends from shared mailboxes".
- Every send is written to the audit log (Settings → Audit): who, from which mailbox, to whom, the subject. Never the message body. Sending is limited to 60 messages per person per hour, and attachments to 3 MB each and 4 MB per message (larger files: share a link).
- Message bodies are shown in a locked-down frame (no scripts, no access to the dashboard) with remote images blocked until you click **Show images**, so senders can't tell you opened their mail.

## 7. Google (Gmail, Calendar, Analytics, Search Console) — if you use Google accounts

1. console.cloud.google.com → create a project ("Kaj Command Center").
2. **APIs & Services → Library**, enable: Gmail API, Google Calendar API, Google Analytics Data API, Google Analytics Admin API, Google Search Console API.
3. **OAuth consent screen**: External, app name, your email. Add yourself (and each Google account you'll connect) as a **test user**.
4. **Credentials → Create credentials → OAuth client ID → Web application**. Authorized redirect URI:
   `https://kaj-command-center.vercel.app/api/connect/gmail/callback`
5. Vercel settings: add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (Production), then redeploy.
6. **Data access** (OAuth consent screen → Data access → Add or remove scopes): add `gmail.modify` and `gmail.send` next to the read-only ones, so the Inbox can organise and reply. These are Google "restricted" scopes: fine while the app is in **Testing** with your accounts listed as test users; publishing the app to everyone would need Google's verification.
7. Dashboard → **Platforms → Google → Connect** for each Google account. Accounts connected before replying existed show **Reconnect to enable replying**: connect them again.

Google sign-in to the dashboard stays off; this reads mail, calendar and analytics, and sends mail only when you press Send in the Inbox.

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

1. Dashboard → **Settings → Notifications → Instant alerts every 5 minutes → Create scheduler link**. Copy the **URL** (`https://kaj-command-center.vercel.app/api/tick`) and the **header value** (`Bearer tick_…`). They're shown once; only a fingerprint of the token is stored.
2. Sign up at **cron-job.org** (free) → **Cronjobs → Create cronjob**.
3. **URL**: paste the URL. **Execution schedule**: every 5 minutes.
4. **Advanced → Headers**: add `Authorization` = `Bearer tick_…` (the value you copied). Timeout 60 seconds. Optionally turn on "notify me when the job fails". **Create**.
5. After ~10 minutes, the Settings panel shows *Running · last call N minutes ago*.

Keep the token private: it can only trigger a check, nothing else. Prefer the header: the panel also shows a fallback URL with the token inside it (`/api/tick/tick_…`) for schedulers that can't send headers, but a token in a URL can end up in access logs. **Replace scheduler link** makes a new token and stops the old one (update cron-job.org afterwards). `Authorization: Bearer <CRON_SECRET>` also works. When the daily check and the scheduler land in the same few minutes, only one of them refetches the platforms.

## 14. Morning brief and weekly reports by email — optional

1. resend.com → sign up → **Domains → Add** `kaj-consulting.com` and add the DNS records it shows.
2. **API Keys → Create**.
3. Vercel settings: `RESEND_API_KEY`, `BRIEF_EMAIL_FROM` = `Command Center <brief@kaj-consulting.com>`, `BRIEF_EMAIL_TO` = `hello@kaj-consulting.com`, then redeploy.

## 15. AI (inbox triage, reply drafts, Ask) — optional

console.anthropic.com → **API Keys → Create** → Vercel settings: `ANTHROPIC_API_KEY`, then redeploy. Typical cost $5–30/month.

## 16. Invite your team

**Team → Invite**: their Microsoft sign-in address, a role and their businesses. They open the site and choose **Sign in with Microsoft**.

---

## 17. Bills: Microsoft 365 admin (licences, service health, invoices)

A separate, owner-only connection on the same Entra app as Outlook. Your mailboxes keep working as they are.

1. **entra.microsoft.com → Identity → Applications → App registrations →** your dashboard app (the one whose ID is in `MS_CLIENT_ID`) **→ API permissions → Add a permission**:
   - **Microsoft Graph → Delegated permissions**: tick `Organization.Read.All` and `ServiceHealth.Read.All` → **Add permissions**.
   - **Add a permission → Azure Service Management** (under "Microsoft APIs") **→ Delegated → `user_impersonation`** → **Add permissions**.
2. Still on **API permissions**, click **Grant admin consent for <your organization>** and confirm. All rows show a green tick.
3. Give the admin who will connect a **billing role**, or invoices stay unreadable (licences and service health still work):
   - **admin.microsoft.com → Billing → Billing accounts →** your account **→ Roles** (or **Billing account roles**) **→ Add → Billing account reader**, *or*
   - **portal.azure.com → Cost Management + Billing → Billing scopes →** your account **→ Access control (IAM) → Add → Billing account reader**.
   Role changes can take a few minutes.
4. In the dashboard: **Platforms → Microsoft 365 admin → Connect Microsoft 365 admin**, sign in as that admin and accept. If Microsoft asks a second time (for Azure billing), accept again; the dashboard does this step automatically when needed.

What you get: paid licences purchased vs assigned (unassigned seats become a low task), open service incidents (tasks), and the last 12 months of Microsoft invoices on **Platform spend → Automatic bills**. If billing can't be read, the card says exactly why (no billing role, consent missing).

## 18. Bills: Google Cloud / Firebase

Read-only, with a service account (no Google sign-in needed).

1. **console.cloud.google.com →** project picker **→ New project** `kaj-dashboard` (any project works; a dedicated one keeps it tidy).
2. **APIs & Services → Library**, enable in that project: **Cloud Billing API**, **Cloud Resource Manager API**, **BigQuery API**, **Firebase Management API**.
3. **IAM & Admin → Service accounts → Create service account** `kaj-dashboard` → **Done** (no roles here).
4. Give it read-only roles (use the service account's e-mail, `kaj-dashboard@kaj-dashboard.iam.gserviceaccount.com`):
   - **Billing → (each billing account) → Account management → Add principal → Billing Account Viewer**.
   - **IAM** at the organization (or on each project) **→ Grant access → Browser** (or **Viewer**) and **Firebase Viewer**.
   - On the project that holds the billing-export dataset: **BigQuery Data Viewer** and **BigQuery Job User**.
5. Turn on the cost export (skip to see projects only): **Billing → Billing export → BigQuery export → Standard usage cost → Edit settings**, pick the project and create a dataset (e.g. `billing_export`) → **Save**. The table `gcp_billing_export_v1_XXXXXX_XXXXXX_XXXXXX` appears in that dataset; **data shows up about a day later**.
6. **Service accounts → kaj-dashboard → Keys → Add key → Create new key → JSON**. A file downloads.
7. Dashboard: **Platforms → Google Cloud / Firebase**: paste the whole JSON file into the key box, and the table id `project.dataset.gcp_billing_export_v1_XXXXXX…` into the second box → **Connect Google Cloud**. The key is checked with Google, stored encrypted and never shown again; delete the downloaded file afterwards. To change only the table later, leave the key box empty.

Costs show per month, project and service (net of credits) on **Platform spend**; projects map to businesses with the rules from step 1. The Platforms page also gets console links per project and per Firebase app.

## 19. Bills from every other platform

The dashboard reads bills wherever a platform has a billing API, using the tokens you already connected. Extra permissions are **optional**: without them that platform's bill comes from e-mail receipts or your own entry, and **Platform spend → Bill coverage** says which.

| Platform | What's read | Optional extra permission |
| --- | --- | --- |
| Cloudflare | Billing history (invoices, domain renewals) and plan prices | Add **Billing: Read** to the API token (dash.cloudflare.com → My Profile → API Tokens → Edit), or create a new token with it and paste it on Platforms. |
| GitHub | Enhanced billing usage (Copilot, Actions, storage) for you and your orgs | Fine-grained token → **Account permissions → Plan: read** (org billing needs an org owner's token). |
| Vercel | Billing charges (Pro/Enterprise teams, incl. Marketplace add-ons like Neon) | None; on the Hobby plan nothing is billed and it says so. |
| Supabase | Plan per organization (no amounts: Supabase has no billing-amount API) | None. Amounts come from receipts or your entry. |
| Stripe | Processing fees (last 30 days, per business) from the balance you already read | None. |
| Anthropic (Claude API) | Monthly cost report | Optional Vercel setting `ANTHROPIC_ADMIN_KEY` = an **Admin API key** (`sk-ant-admin…`, console.anthropic.com → Settings → Admin keys). Not the normal API key. |

Re-creating tokens is optional; nothing stops working if you don't.

**Workspace, Resend, Twilio, domains, Starlink and the rest** have no billing API for customers: invoices and receipts that reach a **shared** mailbox (never a personal one) from Google payments, Microsoft, Vercel, Supabase, GitHub, Cloudflare, Anthropic, Resend, Twilio, Namecheap, GoDaddy, Squarespace, Starlink, Apple, Zoom, Canva, QuickBooks and Stripe receipts are recognised and listed under **Platform spend → Detected from e-mail · check** when the amount is unambiguous. They never count in totals until you click **Track as subscription**.

**No double counting:** a billing API's amount counts in the monthly total only when you have no subscription entry for the same vendor. If you have one, the vendor's row on Platform spend offers **Use billing API** or **Use my entry**.
