import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { canConnectPersonal, canSee, isFullOwner, ROLE_LABEL } from "@/lib/access";
import { getDashboard } from "@/lib/server/dashboard";
import { listPersonalSummaries } from "@/lib/server/store/connections";
import { oauthConfigured } from "@/lib/server/connect";
import { DisconnectMineButton } from "@/components/settings/MyMail";
import { MailAccessChips } from "@/components/mail/bits";
import { signOutEverywhere } from "@/app/actions/auth";
import { requireUser, require2fa, sharedLoginLimitWarning } from "@/lib/server/auth";
import { formatBusinessRules, formatSites, getConfig } from "@/lib/server/config";
import { listAudit } from "@/lib/server/store/audit";
import { getUser } from "@/lib/server/store/users";
import { btn, PageHeader, SeverityIcon, Tag, timeAgo } from "@/components/ui";
import { PlacesForm } from "@/components/pipeline";
import { getSetting } from "@/lib/server/store/settings";
import type { PlaceConfig } from "@/lib/connectors/reviews";
import { BusinessRulesForm, RegenerateCodesForm, ResetTwoFactorForm, SolarForm, SolarTokenForm, WebsitesForm } from "@/components/settings/forms";
import { PushToggle } from "@/components/settings/PushToggle";
import { solarConfig } from "@/lib/server/solar-store";
import { emailEnabled, vapidPublicKey } from "@/lib/server/notify";
import { briefHour } from "@/lib/server/reports";
import { env } from "@/lib/source";
import { HeadPanel } from "@/components/admin/bits";
import { NotifyPrefsForm, PauseButtons, SchedulerLinkForm } from "@/components/settings/NotifyPrefs";
import { getPrefs } from "@/lib/server/alerts/store";
import { lastTick, tickConfigured } from "@/lib/server/alerts/tick";
import { businessTimeZone } from "@/lib/dates";

function timeZones(...extra: (string | null)[]): string[] {
  let all: string[] = [];
  try {
    all = Intl.supportedValuesOf("timeZone");
  } catch {
    all = [];
  }
  return [...new Set([...all, ...extra.filter((z): z is string => !!z), "UTC"])].sort();
}

const RECOVERY_TOTAL = 10;

function C({ children }: { children: ReactNode }) {
  return <code className="bg-cyan/5 px-1.5 py-0.5 font-mono text-[12px] text-[#9be7ff]">{children}</code>;
}

function Sub({ title, children, className = "" }: { title: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`border-t border-line/60 px-4 py-4 sm:px-5 ${className}`}>
      <h3 className="hud-label mb-2 text-[12px] text-ink">{title}</h3>
      {children}
    </div>
  );
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ error?: string; connected?: string }> }) {
  const me = await requireUser();
  const owner = isFullOwner(me);
  const { error: connectError, connected } = await searchParams;
  const personalOn = canConnectPersonal(me);
  // Only this person's own items: getDashboard hands everyone their own personal mail alone.
  const [mine, dash] = personalOn ? await Promise.all([listPersonalSummaries(me.email).catch(() => []), getDashboard()]) : [[], null];
  const [{ businessRules, sites }, user, log, places, solar, solarTokenHash, prefs, tickOn, tickAt] = await Promise.all([getConfig(), getUser(me.email), owner ? listAudit(50) : Promise.resolve([]), getSetting<PlaceConfig[]>("places", []), solarConfig(), getSetting<string | null>("solar_ingest_token_hash", null), getPrefs(me.email), owner ? tickConfigured() : false, owner ? lastTick() : null]);
  const homeZone = businessTimeZone();
  const myZone = prefs.timeZone ?? homeZone;
  const codesLeft = user?.recovery_codes.length ?? 0;
  const rules = formatBusinessRules(businessRules);
  const businessCount = new Set(businessRules.map((r) => r.business)).size;
  const tabs = [...(owner ? [["businesses", "Businesses"]] : []), ...(personalOn ? [["my-mail", "My mail"]] : []), ["security", "Security"], ["notifications", "Notifications"], ...(owner ? [["solar", "Solar"], ["audit", "Audit"]] : [])];

  const msOn = oauthConfigured("microsoft");
  const googleOn = oauthConfigured("gmail");
  const myEmails = dash ? dash.emails.filter((e) => e.owner === me.email) : [];
  const myEvents = dash ? dash.calendar.filter((e) => e.owner === me.email) : [];
  const myProblems = dash?.personalProblems ?? [];
  const myMail = personalOn ? (
    <HeadPanel id="my-mail" accent="#3fd0ff" title="My mail & calendar" status={<span className="hud-label text-[11px] tracking-[0.12em] text-muted">{mine.length ? `${mine.length} connected · private to you` : "private to you"}</span>} bodyClassName="!p-0">
      <div className="px-4 py-4 sm:px-5">
        <p className="text-[13px] text-muted">
          Connect your own mailbox and calendar. Its messages, events and the to-dos made from them are shown to <span className="text-ink">you alone</span>: not to other members and not to the dashboard owner, who only sees that you have one connected.
          {canSee(me, "inbox") ? " Mail shows in your Inbox" : ""}{canSee(me, "inbox") && canSee(me, "agenda") ? " and" : ""}{canSee(me, "agenda") ? " events in your Agenda" : ""}.
        </p>
        {connectError && <p className="mt-3 flex items-start gap-2 text-[13px]"><SeverityIcon severity="critical" size={16} /><span><span className="hud-label mr-1.5 text-[11px] text-critical">Couldn&apos;t connect</span>{connectError}</span></p>}
        {connected && <p className="mt-3 text-[13px] text-emerald">✓ Connected {connected}. Your mail and events show up within a minute.</p>}
      </div>
      {mine.length > 0 && (
        <ul className="border-t border-line/60">
          {mine.map((c) => {
            const problem = myProblems.find((p) => p.account === c.account);
            return (
              <li key={c.id} className="flex items-center gap-3 border-b border-line/40 px-4 py-3 last:border-0 sm:px-5">
                <span className="grid h-8 w-8 shrink-0 place-items-center border border-cyan/60 font-display text-[11px] font-bold text-cyan">{c.provider === "microsoft" ? "M" : "G"}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{c.account}</div>
                  <div className="text-xs text-muted">{c.provider === "microsoft" ? "Microsoft 365" : "Google"} · connected {timeAgo(c.createdAt)}</div>
                  {(c.provider === "microsoft" || c.scopes) && <MailAccessChips provider={c.provider === "microsoft" ? "outlook" : "gmail"} scopes={c.scopes} />}
                  {problem && <div className="mt-1 flex items-start gap-1.5 break-words text-xs"><SeverityIcon severity="high" size={13} /><span><span className="hud-label mr-1 text-[10.5px] text-high">High</span>{problem.error} Reconnect below.</span></div>}
                </div>
                <DisconnectMineButton id={c.id} name={c.account} />
              </li>
            );
          })}
        </ul>
      )}
      {mine.length > 0 && (
        <div className="flex flex-wrap gap-x-5 gap-y-1 border-t border-line/60 px-4 py-3 text-[13px] text-muted sm:px-5">
          <span><b className="font-normal text-ink">{myEmails.filter((e) => e.unread).length}</b> unread · last 14 days</span>
          <span><b className="font-normal text-ink">{myEvents.length}</b> event{myEvents.length === 1 ? "" : "s"} · next 7 days</span>
        </div>
      )}
      <div className="flex flex-wrap gap-2 border-t border-line/60 px-4 py-4 sm:px-5">
        {msOn && <a href="/api/connect/microsoft?mine=1" className={`${btn(mine.some((c) => c.provider === "microsoft") ? "outline" : "solid")} min-h-10 sm:min-h-0`} style={{ "--b": "#3fd0ff" } as CSSProperties}>{mine.some((c) => c.provider === "microsoft") ? "Reconnect Microsoft" : "Connect my Microsoft 365"}</a>}
        {googleOn && <a href="/api/connect/gmail?mine=1" className={`${btn(mine.some((c) => c.provider === "gmail") ? "outline" : "solid")} min-h-10 sm:min-h-0`} style={{ "--b": "#3fd0ff" } as CSSProperties}>{mine.some((c) => c.provider === "gmail") ? "Reconnect Google" : "Connect my Google"}</a>}
        {!msOn && !googleOn && <p className="text-[13px] text-muted">Mailbox sign-in isn&apos;t set up on this dashboard yet. Ask the owner.</p>}
      </div>
      <p className="border-t border-line/60 px-4 py-3 text-xs text-muted sm:px-5">Sign in with your own account ({me.email}): read, organise and send your mail from the Inbox, and read your calendar. Disconnecting deletes the stored sign-in.</p>
    </HeadPanel>
  ) : null;

  const security = (
    <HeadPanel id="security" accent="#3fd0ff" title="Security" status={<span className="hud-label text-[11px] tracking-[0.12em] text-muted">your account</span>} bodyClassName="!p-0">
      <div className="flex items-center gap-4 px-4 py-4 sm:px-5">
        <svg width="40" height="40" viewBox="0 0 24 24" aria-hidden className="shrink-0" style={{ filter: `drop-shadow(0 0 6px ${me.hasTotp ? "#3df5a0" : "#ff9f1c"})` }}>
          <path d="M12 2 20 5v6c0 5-3.4 9.4-8 11-4.6-1.6-8-6-8-11V5Z" fill="none" stroke={me.hasTotp ? "#3df5a0" : "#ff9f1c"} strokeWidth="1.5" />
          {me.hasTotp ? <path d="m8.5 12 2.5 2.5 4.5-5" fill="none" stroke="#3df5a0" strokeWidth="1.8" strokeLinecap="round" /> : <path d="M12 8v5M12 16v.4" stroke="#ff9f1c" strokeWidth="1.8" strokeLinecap="round" />}
        </svg>
        <div className="min-w-0 flex-1">
          {me.hasTotp ? (
            <>
              <div className="text-[17px]">Two-factor authentication is on</div>
              <div className="text-[13px] text-muted">Since {new Date(user!.totp_enabled_at!).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} · {codesLeft} of {RECOVERY_TOTAL} recovery codes left</div>
              <div className="mt-2 flex gap-1" aria-hidden>
                {Array.from({ length: RECOVERY_TOTAL }, (_, i) => <i key={i} className={`h-1.5 w-5 ${i < codesLeft ? (codesLeft <= 2 ? "bg-high" : "bg-emerald shadow-[0_0_6px_#3df5a0]") : "bg-line"}`} />)}
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 text-[17px]"><span className="hud-label text-[11px] text-high">High</span>Two-factor authentication is off</div>
              <div className="text-[13px] text-muted"><Link href="/login/2fa/setup" className="text-cyan hover:underline">Turn it on ›</Link>{require2fa() ? "" : " (Optional because REQUIRE_2FA=false.)"}</div>
            </>
          )}
        </div>
      </div>
      {me.hasTotp && (
        <>
          <Sub title="Recovery codes">
            <p className="mb-3 text-[13px] text-muted">Enter a current code to make {RECOVERY_TOTAL} new ones. The old ones stop working.</p>
            <RegenerateCodesForm />
          </Sub>
          <Sub title="Lost your authenticator?">
            <p className="mb-3 text-[13px] text-muted">Resetting removes 2FA and signs out everywhere; you&apos;ll set it up again at next sign-in.</p>
            <ResetTwoFactorForm />
          </Sub>
        </>
      )}
      {sharedLoginLimitWarning() && (
        <Sub title="Sign-in rate limit">
          <p className="flex items-start gap-2 text-[13px]"><SeverityIcon severity="high" size={18} /><span><span className="hud-label mr-1.5 text-[11px] text-high">High</span>{sharedLoginLimitWarning()}</span></p>
        </Sub>
      )}
      <Sub title="Sessions">
        <p className="mb-3 text-[13px] text-muted">Signs this account out on every browser and phone, including this one.</p>
        <form action={signOutEverywhere}>
          <button className={`${btn()} min-h-10 sm:min-h-0`} style={{ "--b": "#ff5fd7" } as CSSProperties}>Sign out of all devices</button>
        </form>
      </Sub>
    </HeadPanel>
  );

  const tickFresh = tickAt && Date.now() - Date.parse(tickAt) < 15 * 60_000;
  const notifications = (
    <HeadPanel id="notifications" accent="#ff5fd7" title="Notifications" status={<span className="hud-label text-[11px] tracking-[0.12em] text-muted">app push{owner ? " · email brief" : ""}</span>} bodyClassName="!p-0">
      <div className="px-4 py-4 sm:px-5">
        <p className="mb-3 text-[13px] text-muted">Alerts arrive as push notifications on this phone or computer, only for items you can see and tasks assigned to you. Install the dashboard (Add to Home Screen) for the best experience.</p>
        <PushToggle publicKey={vapidPublicKey()} />
      </div>
      <Sub title="When to alert you">
        <NotifyPrefsForm prefs={prefs} zones={timeZones(prefs.timeZone, homeZone)} businessZone={homeZone} />
      </Sub>
      <Sub title="Pause non-critical">
        <p className="mb-2.5 text-[13px] text-muted">High alerts wait until the pause ends; critical ones still come through.</p>
        <PauseButtons pausedUntil={prefs.pausedUntil} timeZone={myZone} />
      </Sub>
      <Sub title="What you get">
        <ul className="grid gap-1.5 text-[13px]">
          <li className="flex items-center gap-2"><SeverityIcon severity="critical" size={15} /><span className="hud-label text-[11px] text-critical">Critical</span><span className="text-muted">at once, always</span></li>
          <li className="flex items-center gap-2"><SeverityIcon severity="high" size={15} /><span className="hud-label text-[11px] text-high">High</span><span className="text-muted">at once, held during quiet hours</span></li>
          <li className="flex items-center gap-2"><SeverityIcon severity="medium" size={15} /><span className="hud-label text-[11px] text-cyan">Medium</span><span className="text-muted">one noon digest</span></li>
          <li className="flex items-center gap-2"><SeverityIcon severity="low" size={15} /><span className="hud-label text-[11px] text-muted">Low</span><span className="text-muted">no push; in the morning brief</span></li>
        </ul>
        <p className="mt-2 text-[12px] text-muted">Website outages are confirmed by a second check a few minutes later. More than 5 pushes in 10 minutes are combined into one. History: the bell, and the <Link href="/notifications#delivery" className="text-cyan hover:underline">delivery log</Link>.</p>
      </Sub>
      {owner && (
        <Sub title={<>Instant alerts every 5 minutes · scheduler link</>}>
          <p className="mb-2 text-[13px] text-muted">
            Vercel&apos;s free plan checks the platforms once a day. A free scheduler calling this link every 5 minutes makes alerts (and website checks) near-instant.{" "}
            {tickOn ? (tickFresh ? <span className="text-emerald">Running · last call {timeAgo(tickAt)}.</span> : <span className="text-high">Link created, {tickAt ? `last call ${timeAgo(tickAt)}` : "never called yet"}.</span>) : <span>Not set up yet.</span>}
          </p>
          <SchedulerLinkForm exists={tickOn} />
          <ol className="mt-3 grid list-decimal gap-1 pl-5 text-[13px] text-muted marker:text-cyan">
            <li>Click <span className="text-ink">Create scheduler link</span>; copy the URL and the header value (shown once).</li>
            <li>Sign up free at <a href="https://cron-job.org" target="_blank" rel="noreferrer" className="text-cyan hover:underline">cron-job.org</a> → <span className="text-ink">Create cronjob</span>.</li>
            <li>Paste the URL; schedule <span className="text-ink">Every 5 minutes</span>.</li>
            <li>Under <span className="text-ink">Advanced → Headers</span>, add key <C>Authorization</C> with the value <C>Bearer tick_…</C>; set the timeout to 60 seconds. Save.</li>
            <li>Come back here in 10 minutes: this panel shows when it was last called.</li>
          </ol>
          <p className="mt-2 text-[12px] text-muted">Keep the token private: it can only trigger a check, nothing else. Prefer the header: a token inside the URL (the fallback, for schedulers without headers) can end up in access logs. Replacing it stops the old one. <C>Authorization: Bearer CRON_SECRET</C> works on <C>/api/tick</C> too.</p>
        </Sub>
      )}
      {owner && (
        <Sub title={<>Morning brief by email · {briefHour()}:00 ({env("BUSINESS_TIMEZONE") ?? "UTC"})</>}>
          <p className="text-[13px] text-muted">
            {emailEnabled() ? <><span className="text-emerald">On</span>, to {env("BRIEF_EMAIL_TO")}.</> : <>Off. Set <C>RESEND_API_KEY</C>, <C>BRIEF_EMAIL_FROM</C> and <C>BRIEF_EMAIL_TO</C>.</>} Weekly reports go out on Mondays; see <Link href="/reports" className="text-cyan hover:underline">Reports</Link>. Alerts never go by email.
          </p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <Link href="/platforms#resend"><Tag color={emailEnabled() ? "#3df5a0" : "#7f97ab"}>Resend · {emailEnabled() ? "on" : "off"}</Tag></Link>
            <Tag color="#7f97ab">Weekly report · Mondays</Tag>
          </div>
        </Sub>
      )}
    </HeadPanel>
  );

  return (
    <>
      <PageHeader title="Settings" subtitle={`Signed in as ${me.email}${me.envOwner ? " · Owner" : ` · ${ROLE_LABEL[me.role]}${me.businesses ? ` for ${me.businesses.join(", ")}` : ""}`}`}>
        <nav aria-label="Settings sections" className="flex flex-wrap gap-2">
          {tabs.map(([id, label]) => <a key={id} href={`#${id}`} className={`${btn()} min-h-10 shrink-0 sm:min-h-0`} style={{ "--b": "#ff5fd7" } as CSSProperties}>{label}</a>)}
        </nav>
      </PageHeader>

      {!owner ? (
        <div className="grid gap-5 xl:grid-cols-2">
          <div className="grid content-start gap-5">
            {myMail}
            {security}
          </div>
          {notifications}
        </div>
      ) : (
        <div className="grid gap-5 xl:grid-cols-2">
          <div className="grid content-start gap-5">
            <HeadPanel id="businesses" accent="#ffd84d" title="Businesses" status={<span className="hud-label text-[11px] tracking-[0.12em] text-muted">{businessCount} businesses · {businessRules.length} rules</span>}>
              <p className="mb-3 text-[13px] text-muted">One rule per line: <C>name fragment = Business</C>. Repos, projects and databases whose name contains the fragment are grouped under that business.</p>
              <BusinessRulesForm initial={rules} />
            </HeadPanel>
            <HeadPanel id="websites" accent="#2ef2d0" title="Websites" status={<span className="hud-label text-[11px] tracking-[0.12em] text-muted">{sites.length} sites · probed every 5 min</span>}>
              <p className="mb-3 text-[13px] text-muted">One site per line: <C>domain | Business | Supabase project ref (optional)</C>. Each is probed every 5 minutes; with a project ref, sign-ups are counted from its auth users.</p>
              <WebsitesForm initial={formatSites(sites)} />
            </HeadPanel>
            <HeadPanel id="places" accent="#ffd84d" title="Google Business listings" status={<span className="hud-label text-[11px] tracking-[0.12em] text-muted">reviews</span>}>
              <p className="mb-3 text-[13px] text-muted">One per line: <C>place ID | Business</C>. Find a place ID with Google&apos;s Place ID Finder. Needs <C>GOOGLE_PLACES_API_KEY</C>{process.env.GOOGLE_PLACES_API_KEY ? " (set)" : " (not set yet)"}.</p>
              <PlacesForm initial={places.map((p) => `${p.placeId} | ${p.business}`).join("\n")} />
            </HeadPanel>
            <HeadPanel id="solar" accent="#c6f432" title="Solar" status={<span className="hud-label text-[11px] tracking-[0.12em] text-muted">ingest · alerts</span>}>
              <p className="mb-3 text-[13px] text-muted">Readings are pushed to <C>/api/ingest/solar</C> with <C>Authorization: Bearer &lt;token&gt;</C>. One line per station below: <C>station id = Business</C>.</p>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border border-lime/40 bg-lime/5 px-4 py-3">
                <div>
                  <div className="text-sm">Ingest token</div>
                  <div className="text-xs text-muted">{env("SOLAR_INGEST_TOKEN") ? "Set via SOLAR_INGEST_TOKEN; you can add a second one here." : solarTokenHash ? "A token exists (only its hash is stored)." : "None yet: create one to start."}</div>
                </div>
                <SolarTokenForm exists={!!solarTokenHash} />
              </div>
              <SolarForm initial={{ daylightFrom: solar.daylightFrom, daylightTo: solar.daylightTo, offlineAfterMin: solar.offlineAfterMin, lowBatteryPct: solar.lowBatteryPct, stations: Object.entries(solar.businesses).map(([k, v]) => `${k} = ${v}`).join("\n") }} />
            </HeadPanel>
          </div>
          <div className="grid content-start gap-5">
            {myMail}
            {security}
            {notifications}
            <HeadPanel id="audit" accent="#a98bff" title="Audit log" status={<span className="hud-label text-[11px] tracking-[0.12em] text-muted">last {log.length}</span>} bodyClassName="!p-0">
              {log.length === 0 ? <p className="px-4 py-6 text-center text-sm text-muted sm:px-5">Nothing recorded yet.</p> : (
                <ul className="max-h-[36rem] overflow-y-auto">
                  {log.map((e) => (
                    <li key={e.id} className="grid grid-cols-[64px_1fr] gap-3 border-b border-line/40 px-4 py-3 text-sm last:border-0 sm:grid-cols-[84px_1fr] sm:px-5">
                      <span className="pt-0.5 font-mono text-xs text-muted tabular-nums">{timeAgo(e.at)}</span>
                      <span className="min-w-0 break-words">
                        <C>{e.action}</C>
                        {e.target ? <span> · {e.target}</span> : null}
                        <span className="block text-xs text-muted">{e.actor}{e.ip ? ` · ${e.ip}` : ""}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </HeadPanel>
          </div>
        </div>
      )}
    </>
  );
}
