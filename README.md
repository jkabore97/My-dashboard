# Kaj Command Center

One private dashboard for every business Kaj Consulting runs: repositories, hosting, databases, email, websites and their users. Everything that needs attention is pulled into one to-do list, ranked by severity, that you can work through.

![Overview](docs/overview.png)

## What's in it

| Section | What you see and do |
|---|---|
| **Overview** | Critical/high counts, top to-dos, latest notifications, a card per business |
| **To-do** | One list ranked **critical → high → medium → low**. Mark done, snooze (4h to 1 week), reassign to a business, add your own tasks. Open / Snoozed / Done views. |
| **Inbox** | A mail client for every connected Outlook and Gmail mailbox: all folders, search, paging, read (sandboxed HTML, images on request), flag, archive, delete, reply / reply all / forward / new message with attachments. Plus a triage view of the last 14 days ranked by urgency. With `ANTHROPIC_API_KEY`, Claude reads new mail, sets the urgency, writes a one-line summary and drafts replies. Needs `Mail.ReadWrite` + `Mail.Send` (docs/CONNECT.md step 6) |
| **Ask** | Ask questions in plain English ("Which client hasn't paid?", "What broke this week?"), answered by Claude from the dashboard's live data |
| **Notifications** | Email, GitHub, Vercel, Stripe, Supabase and uptime events, kept 90 days |
| **Agenda** | The next 7 days from every connected Google Calendar and Outlook calendar; today's meetings on the Overview |
| **Clients** | Built-in pipeline: clients, deals moving lead → proposal → negotiation → won/lost, values, next steps with due dates, win rate |
| **Analytics** | Google Analytics 4 sessions, visitors, key events and top pages per site (matched automatically), Search Console clicks and top searches, registered-user trend, Google rating and reviews |
| **Money** | Stripe revenue (30-day chart), net, MRR, balances per business; money owed to you (Stripe + invoices you add); subscriptions with monthly cost per business and renewal dates. Stripe test-mode keys are accepted but kept out of totals and tasks |
| **Deadlines** | Taxes, filings, licenses, insurance, contracts. Repeating ones (monthly / quarterly / yearly) roll forward when done |
| **Domains** | Registration and SSL expiry for every domain, plus SPF / DKIM / DMARC email health, checked twice a day |
| **Security** | Dependabot and leaked-secret alerts, Supabase advisor findings, GitHub 2FA, a 2FA checklist for your other accounts, and this dashboard's own hardening |
| **Websites & users** | Uptime every 5 minutes with a 24-hour history strip, registered users and new sign-ups |
| **Cameras** | Hikvision recorders (NVRs) through a secure tunnel: every camera's status, live snapshots refreshed every 30 s, recording-disk health, and real-time alarms (video loss, disk error, failed logins, tampering, motion) |
| **Solar** | Your SOFAR system: production now and today, battery, grid import/export, home use, a production curve and energy per day. Faults, alarms, silence in daylight and low battery become tasks |
| **Reports** | A weekly one-pager per business (revenue vs last week, new users, uptime, issues closed, deals won, solar), printable and emailed on Mondays, plus a morning brief every day |
| **Repositories / Hosting / Databases** | GitHub, Vercel, Cloudflare Workers, Supabase (with security advisors), Cloudflare D1 |
| **Platforms** | Connect platforms with one click or an API token, set up webhooks, check the scheduler |
| **Team** | Invite people with a role and the businesses they work on, change their access, disable or remove them, reset their 2FA or remove their passkeys. Recent task activity from everyone |
| **Settings** | Businesses, websites, solar, push notifications on this device, two-factor authentication, sign out everywhere, audit log (team members see only their own sign-in and device settings) |

Some tasks have a **one-click fix** next to them, always behind a confirmation and written to the audit log: **Redeploy** a failed Vercel production deploy, **Restore** a paused Supabase project, **Re-run failed jobs** for failing GitHub Actions. They need a token with write access; a read-only token gets a clear "reconnect with write access" message.

### Where tasks come from

| Origin | Examples | Closes itself when |
|---|---|---|
| **Signals** (checked every 5 min) | Site down, production deploy failed, Supabase RLS disabled, urgent unread email, open PRs | The condition clears. It reopens if the condition comes back. |
| **Money & risk** (Phase 2) | Stripe dispute to answer, invoice overdue (critical after 30 days), subscription renewing in 7 days or expiring with auto-renew off, deadline inside its reminder window, domain or certificate about to expire (or a certificate that is expired or invalid), missing SPF/DMARC, high/critical Dependabot alert | The condition clears (invoice paid, deadline done, domain renewed…) |
| **Growth** (Phase 3) | A deal's next step is due (high after 3 days late), a deal passed its expected close date, a proposal stalled 14 days with no next step, a review of 3★ or less in the last 30 days, a site's traffic down 40%+ week on week | The condition clears (next step moved or done, deal closed, …) |
| **Devices** (Phase 4) | Cameras offline at a site, a recording disk in error or missing (critical), the inverter in fault (critical) or raising alarms, no solar reading for 30 minutes in daylight, battery below 15% | The condition clears (camera back, disk healthy, inverter normal, readings resume) |
| **Webhooks** (real time) | Stripe dispute or failed payout, CI failing on `main`, Dependabot or leaked-secret alert, NVR video loss / disk error / failed logins / tampering | The platform reports it fixed (dispute closed, CI green, alert fixed, video back). Failed-login alarms stay until you mark them done |
| **You** | Anything you add on the To-do page | You mark it done |

When a webhook and polling both see the same dispute, failed invoice or security alert, you get one task, not two, and marking it done keeps it done while the problem persists. If the platform reports it fixed but polling still sees the problem a few minutes later, the polled task appears. Marking a deadline's task done also completes that deadline (repeating ones move to their next date).

Marking a signal task done keeps it done for as long as the condition persists. A source that is temporarily failing (or one failing mailbox, project or repo within it) never auto-closes its tasks; it shows up as a connector error instead. Disconnecting a platform closes its signal tasks.

## Security

- Sign in with Microsoft, Google and/or a password (`SIGN_IN_METHODS=microsoft` allows Microsoft only), then **mandatory 2FA** with an authenticator app. Ten single-use recovery codes are issued.
- **Passkeys** (Face ID, fingerprint or device PIN): after a full sign-in with 2FA, anyone can add one under *Settings → Security → Add a passkey* (it needs a sign-in from the last 10 minutes, or a fresh authenticator code). *Sign in with a passkey* on the login page then skips the authenticator code entirely, and on the 2FA step after Microsoft *Use a passkey instead of a code* works too. It's offered even with `SIGN_IN_METHODS=microsoft`, because a passkey can only be added by someone who already passed the configured method and 2FA. Passkeys are bound to `APP_URL` (its host is the WebAuthn RP ID; set it, or they're hidden), must verify the user, and are discoverable (no username typed). Challenges are single-use, expire after 5 minutes and are tied to the browser; signature counters are checked for cloned keys; attempts are rate-limited and audited. A disabled member or an owner removed from `ALLOWED_EMAILS` can't use their passkeys. The authenticator app and recovery codes stay as the fallback. Owners can remove a member's passkeys on the Team page. `PASSKEYS=false` turns them off everywhere.
- Microsoft sign-in identifies people by their Microsoft account name (UPN), whose domain the organization must have verified, never by the editable email claim; guest accounts are refused, and each person is pinned to the Microsoft account they first signed in with.
- Sessions are HMAC-signed cookies (7 days). "Sign out of all devices" revokes every session.
- Platform tokens, OAuth refresh tokens, TOTP secrets and webhook secrets are **encrypted with AES-256-GCM** before they reach the database.
- Every webhook is signature-checked. Cron needs `CRON_SECRET`. Failed login and 2FA attempts are rate-limited (a correct one doesn't count). Password sign-in is limited per IP on Vercel, or behind your own reverse proxy with `TRUSTED_PROXY=true`; without a trustworthy IP, all callers share one looser limit (100 failures an hour), and a tripped limit is audited.
- Every sign-in, connection change, setting change and task action goes to the audit log (Settings).
- Team members' access is checked on every page and every action on the server, not just hidden in the menu. Member passwords are hashed with scrypt; invite and client-page links are random 256-bit tokens stored only as hashes.
- Row-level security is enabled on all tables, so Supabase's public API keys can't read them.
- Camera recorders are only reached through an https tunnel hostname (IP addresses, local names and names that resolve to private addresses are refused, checked again before every request). Snapshots are only passed through as JPEG or PNG. Snapshots are fetched server-side, so the browser never sees the NVR's address or password. The solar ingest token is stored as a hash.
- AI features send a compact summary of dashboard data (never passwords or tokens) to Anthropic's API, are limited to 60 requests an hour, and treat email text as untrusted content.

## Run locally

```bash
npm install
cp .env.example .env.local   # set DASHBOARD_PASSWORD; add REQUIRE_2FA=false to skip 2FA locally
npm run dev                  # http://localhost:3000
```

Without `DATABASE_URL`, an embedded Postgres (PGlite) is created in `.data/`. With nothing connected, every section shows sample data.

```bash
npm test          # unit + database tests (in-memory Postgres)
npm run test:pg   # database tests against a real Postgres (TEST_DATABASE_URL)
npm run typecheck
```

## Deploy (Vercel + Supabase), signing in with Microsoft

1. **Database:** create a Supabase project, or use an existing one. Copy the **transaction pooler** connection string into `DATABASE_URL`. Tables are created on first start.
2. **Deploy** the repo on Vercel (Add New → Project → import it). Note the address it gets, e.g. `https://my-dashboard.vercel.app`, or add your own domain. That address is your `APP_URL`.
3. **Microsoft app** at [entra.microsoft.com](https://entra.microsoft.com) → App registrations → New registration:
   - *Supported account types:* **Accounts in this organizational directory only** if everyone has a Kaj Consulting Microsoft 365 account (simplest and safest). Choose *any organizational directory and personal Microsoft accounts* only if some people use outlook.com/hotmail addresses.
   - *Redirect URI (Web):* `APP_URL/api/auth/microsoft/callback`. Add `APP_URL/api/connect/microsoft/callback` too if you'll connect Outlook mail and calendar.
   - Certificates & secrets → New client secret. Copy the **Value**.
   - From Overview, copy the **Application (client) ID** and the **Directory (tenant) ID**.
4. **Environment variables** (Vercel → Project → Settings → Environment Variables), then redeploy:
   - `SIGN_IN_METHODS=microsoft` (no password or Google sign-in at all)
   - `ALLOWED_EMAILS=` the address you sign in to Microsoft with (you become the owner)
   - `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_TENANT_ID` (the tenant ID for a single-organization app; leave it empty for the multi-account option)
   - `APP_URL`, `DATABASE_URL`, `SESSION_SECRET` (`openssl rand -base64 48`), `ENCRYPTION_KEY` (`openssl rand -base64 32`, keep it safe), `CRON_SECRET` (`openssl rand -hex 32`). Production refuses to start without the secrets.
   - `vercel.json` runs `/api/cron/check` once a day at 12:00 UTC (7–8 a.m. in New York), which the free Hobby plan allows; it also sends the morning brief, any time from `BRIEF_HOUR` to six hours later. Opening the dashboard always syncs fresh data. For checks every 5 minutes (uptime alerts, push for new critical items), either switch to Pro and set the schedule to `*/5 * * * *`, or have a free scheduler such as cron-job.org call `APP_URL/api/tick` every 5 minutes with the header `Authorization: Bearer <token from Settings → Notifications>` (docs/CONNECT.md step 13b); `Bearer <CRON_SECRET>` works too, and `/api/tick/<token>` is a fallback for schedulers without headers.
5. **Sign in** at your `APP_URL` with Microsoft, scan the 2FA QR code, and save your recovery codes. Then add a passkey (Settings → Security → *Add a passkey*) so later sign-ins skip the code.
6. **Team page:** invite people by the address they sign in to Microsoft with (usually their work email). They open the link (or just the dashboard) and choose *Sign in with Microsoft*.

Switching `SIGN_IN_METHODS` signs out every session made with a method that's now off. Each person is tied to the Microsoft account they first sign in with; if a member's Microsoft account is recreated, use *Reset Microsoft link* on the Team page. If it happens to you as the owner, run `update users set ms_subject = null where email = 'you@yourdomain.com';` in the database (Supabase → SQL editor), then sign in again. Changing your address in `ALLOWED_EMAILS` needs nothing: the old address gives up the link.
7. **Platforms page:** connect GitHub, Vercel, Gmail (one per mailbox), Supabase and Cloudflare (one account each; connecting another replaces it), then add the webhook URLs it shows to GitHub, Vercel, Stripe and Supabase.
8. **Settings:** list your businesses and websites. [docs/CONNECT.md](docs/CONNECT.md) walks through connecting every platform step by step.

## Team and client pages

**Roles.** Owners set in the environment (`DASHBOARD_PASSWORD`, `ALLOWED_EMAILS`) always have full access. Everyone else is invited from the **Team** page with one role and either every business or a list of them:

| Role | Sees |
|---|---|
| **Owner** | Everything. With every business, also Platforms, Settings, the Team page and the audit log |
| **Developer** | Repos, hosting, databases, websites, domains, security, analytics |
| **Assistant** | Inbox, agenda, clients, deadlines, cameras, solar |
| **Accountant** | Money, invoices, subscriptions, deadlines, clients, weekly reports |

Everyone gets the Overview, To-do, Ask and their own Settings. Inside each page, a person limited to some businesses only sees rows tagged with those businesses; anything untagged (a manual task without a business, a domain no site maps to) is only shown to people with every business. Ask, push notifications and the to-do list follow the same rules. Calendars aren't tied to a business, so whoever has the Agenda sees them.

**Inviting.** Team → Invite: email, role, businesses. You get a link (valid 7 days; it's also emailed when Resend is set up). With `SIGN_IN_METHODS=microsoft` they sign in with the Microsoft account for that address; otherwise they can choose a password of 12+ characters, or use Microsoft or Google with that address. Everyone then sets up an authenticator app; 2FA is mandatory. Disabling someone signs them out at once and stops their notifications; removing them unassigns their tasks.

**Assigning tasks.** Any task can be assigned to someone who can see its business, from the To-do list or when adding a task. They get a push notification, and an *Assigned to me* view. The *Activity* view (and the Team page) shows who did what: created, assigned, snoozed, moved, marked done.

**Client status pages.** Clients → *Status page* on a client: pick which monitored sites to show and whether to list their projects. The client gets a private link to a read-only page with uptime (live status, last 24 hours, 7 and 30 days) and each project's stage in plain words. No amounts, notes or next steps are shown, it's built only from data the dashboard already stored, and it's never indexed. Making a new link retires the old one; *Turn off* or archiving the client stops it.

## Cameras (Hikvision)

The dashboard talks to the NVR's ISAPI interface (the same one the web interface uses), so nothing has to be installed on the recorder. Never open the NVR to the internet with port forwarding; put it behind a tunnel instead.

1. **Make a viewer account on the NVR.** Configuration → System → User Management → Add: an *Operator* or *User* with only **Remote: Live View** and **Remote: Parameters Settings** (view). Don't use `admin`.
2. **Tunnel the NVR's web port.** On any always-on computer (or a Raspberry Pi) on the same network as the NVR, install `cloudflared`, then in the Cloudflare dashboard: Zero Trust → Networks → Tunnels → Create a tunnel → Public hostname `nvr.yourdomain.com` → Service `http://<NVR-LAN-IP>:80`. (Tailscale Funnel works too.)
3. **Lock the tunnel (recommended).** Zero Trust → Access → Applications → add `nvr.yourdomain.com`, policy action *Service Auth*, and create a **Service token**. Keep its client ID and secret.
4. **Connect it.** Platforms → Hikvision cameras → *Add a recorder site*: the tunnel address, the viewer login, a site name and business, and the Access service token if you made one. The dashboard checks it can read the NVR before saving. Add one per site.
5. **Real-time alarms (optional).** Platforms → Real-time webhooks → *Hikvision NVR alarms* → Generate. On the NVR: Configuration → Network → Advanced → **Alarm Server** (HTTP listening): host = your dashboard's domain, port 443, protocol HTTPS, URL = `/api/webhooks/hikvision/<secret>/<site id>` (the site id is shown under each site on the Cameras page). Then, under Event → Basic/Smart Event for each camera, tick **Notify Surveillance Center** for video loss, HDD error, illegal login and the motion events you care about. Motion is kept as low-priority history, at most once per camera every 10 minutes.

Status is checked every 5 minutes with the rest of the dashboard; snapshots load on demand while the Cameras page is open.

## Solar (SOFAR inverter / Fsolar)

SOFAR doesn't offer a public API for the Fsolar app yet, so readings are **pushed** to the dashboard by something that can read your inverter. The usual route is Home Assistant with the **Solarman** integration (for SOFAR's Wi-Fi logger stick) or a SOFAR Modbus integration.

1. Settings → Solar → **Create ingest token** (or set `SOLAR_INGEST_TOKEN`). Optionally map the station id to a business, and adjust daylight hours, the offline delay and the low-battery level.
2. In Home Assistant, add to `configuration.yaml` (replace the `sensor.…` names with your inverter's entities), and put `kaj_solar_auth: "Bearer sol_…"` in `secrets.yaml`:

```yaml
rest_command:
  kaj_solar:
    url: "https://YOUR-DASHBOARD-DOMAIN/api/ingest/solar"
    method: POST
    headers:
      Authorization: !secret kaj_solar_auth
    content_type: "application/json"
    payload: >-
      {"station": "home",
       "powerW": {{ states('sensor.inverter_pv_power') | float(0) }},
       "todayKWh": {{ states('sensor.inverter_daily_production') | float(0) }},
       "totalKWh": {{ states('sensor.inverter_total_production') | float(0) }},
       "batterySoc": {{ states('sensor.inverter_battery_soc') | float(0) }},
       "batteryW": {{ states('sensor.inverter_battery_power') | float(0) }},
       "gridW": {{ states('sensor.inverter_grid_power') | float(0) }},
       "loadW": {{ states('sensor.inverter_load_power') | float(0) }},
       "status": "{{ 'fault' if states('sensor.inverter_status') | lower in ['fault', 'error', 'permanent fault'] else 'normal' }}"}

automation:
  - alias: "Send solar reading to Kaj Command Center"
    trigger:
      - platform: time_pattern
        minutes: "/5"
    action:
      - service: rest_command.kaj_solar
```

Signs: `batteryW` is positive while charging, `gridW` is positive while importing and negative while exporting. Every field except `station` is optional. Up to 50 readings can be sent at once as `{"readings": [...]}`, for example to backfill. Without Home Assistant, any script on the same network can post the same JSON:

```bash
curl -X POST https://YOUR-DASHBOARD-DOMAIN/api/ingest/solar \
  -H "Authorization: Bearer sol_…" -H "Content-Type: application/json" \
  -d '{"station":"home","powerW":3200,"todayKWh":14.2,"batterySoc":78,"status":"normal"}'
```

**Direct Fsolar sync:** ask SOFAR support (or your installer) for API access for your Fsolar account. Once they provide the API credentials, the connector can poll the Fsolar cloud directly and the bridge becomes optional.

## Notifications, brief and AI

- **Push to your phone:** generate keys once with `npx web-push generate-vapid-keys`, set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` (`mailto:you@…`), then Settings → Notifications → *Enable notifications on this device*. On iPhone, first add the dashboard to the Home Screen (Share → Add to Home Screen) and open it from there. Alerts follow each person's access, quiet hours (10 PM–7 AM in their zone; critical always comes through), a noon digest for medium items, and a 5-per-10-minutes limit; see docs/CONNECT.md step 13. For checks every 5 minutes on the free plan, create the scheduler token in Settings → Notifications and add it to cron-job.org (step 13b).
- **Morning brief and weekly reports by email:** create a [Resend](https://resend.com) API key, verify your sending domain, and set `RESEND_API_KEY`, `BRIEF_EMAIL_FROM` and `BRIEF_EMAIL_TO` (comma-separated for several people). The brief goes out daily at `BRIEF_HOUR` (default 7) in `BUSINESS_TIMEZONE`. Each business's weekly report goes out on Mondays. The Reports page can also print a report as a PDF or send it now.
- **AI (Claude):** set `ANTHROPIC_API_KEY` to turn on email triage (new unread mail, read once and cached), reply drafts in the Inbox, and the Ask page. `OWNER_NAME` sets the name drafts are signed with.

## Architecture

```
Platforms ─► connectors (src/lib/connectors) ─► collect() ─► persist(): tasks, events, uptime snapshots ─► Postgres
Webhooks ─► /api/webhooks/* (verified) ─► events + event tasks ─────────────────────────────────────────┘
Vercel Cron ─► /api/cron/check ─► collect + persist + AI triage + push + brief + cleanup     pages read ◄┘
Home Assistant / scripts ─► /api/ingest/solar (token) ─► solar snapshots
NVR (tunnel) ◄─ ISAPI (status, snapshots) · NVR alarm server ─► /api/webhooks/hikvision/<secret>/<site>
```

- `src/lib/connectors/*`: one file per platform, normalized into `src/lib/types.ts`.
- `src/lib/aggregate.ts`: fetches everything and derives tasks (`deriveTasks`, plus `risk.ts`, `growth.ts` and `devices.ts` rules).
- `src/lib/server/ai.ts`, `triage.ts`, `ask-context.ts`: Claude features. `notify.ts`, `reports.ts`, `brief.ts`: push, email brief and weekly reports. `alerts/`: who gets which push and when (pure rules in `decide.ts`, routing and delivery log in `run.ts`, the 5-minute tick in `tick.ts`). `fixes.ts`: one-click fixes.
- `src/lib/server/sync.ts`: persists signals; `store/*` holds the database access; `migrations.ts` holds the schema.
- `src/lib/server/auth.ts`, `twofactor.ts`, `session.ts`: sign-in, 2FA, sessions. `src/proxy.ts` guards every route.
- `src/lib/server/passkeys.ts`, `passkey-config.ts`, `src/app/actions/passkeys.ts`: passkeys (WebAuthn via SimpleWebAuthn): registration, sign-in, the 2FA step, challenges and counters.

## Adding a platform

1. Write `src/lib/connectors/<name>.ts` returning a shared type via `fromSource(...)`. Read credentials through `src/lib/server/credentials.ts`.
2. Call it from `collect()` in `src/lib/aggregate.ts` and add rules to `deriveTasks` with a new scope.
3. Add it to `PLATFORM_DEFS` in `src/lib/platforms.ts`. For a webhook, add a handler in `webhook-handlers.ts` and a route.

See **[PROPOSAL.md](PROPOSAL.md)** for the roadmap.
