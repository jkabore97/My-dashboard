import type { ReactNode } from "react";
import Link from "next/link";
import { canConnectPersonal, canSee, isFullOwner, ROLE_LABEL } from "@/lib/access";
import { getDashboard } from "@/lib/server/dashboard";
import { listPersonalSummaries } from "@/lib/server/store/connections";
import { oauthConfigured } from "@/lib/server/connect";
import { DisconnectMineButton } from "@/components/settings/MyMail";
import { MailAccessChips } from "@/components/mail/bits";
import { signOutEverywhere } from "@/app/actions/auth";
import { readSession, requireUser, require2fa, sharedLoginLimitWarning } from "@/lib/server/auth";
import { listPasskeys, passkeysUsableHere, sessionIsFresh } from "@/lib/server/passkeys";
import { PasskeyManager } from "@/components/settings/Passkeys";
import { formatBusinessRules, formatSites, getConfig } from "@/lib/server/config";
import { listAudit } from "@/lib/server/store/audit";
import { getUser } from "@/lib/server/store/users";
import { KeyRound, LogOut, Mail, ShieldCheck } from "lucide-react";
import { Group, GroupBody, Groups, IconTile, PageHeader, Row, SeverityIcon, SYS, Tag, timeAgo } from "@/components/ui";
import { PlacesForm } from "@/components/pipeline";
import { getSetting } from "@/lib/server/store/settings";
import type { PlaceConfig } from "@/lib/connectors/reviews";
import { BusinessRulesForm, RegenerateCodesForm, ResetTwoFactorForm, SolarForm, SolarTokenForm, WebsitesForm } from "@/components/settings/forms";
import { PushToggle } from "@/components/settings/PushToggle";
import { solarConfig } from "@/lib/server/solar-store";
import { emailEnabled, vapidPublicKey } from "@/lib/server/notify";
import { briefHour } from "@/lib/server/reports";
import { env } from "@/lib/source";
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
  return <code className="rounded-md bg-fill px-1.5 py-0.5 font-mono text-[12.5px] text-ink">{children}</code>;
}

const initials = (name: string, email: string) => {
  const base = name && name !== email ? name : email.split("@")[0];
  const parts = base.replace(/[^a-z0-9 ]/gi, " ").trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
};

/** One "severity → when it arrives" row. */
function SevRow({ severity, word, text }: { severity: "critical" | "high" | "medium" | "low"; word: string; text: string }) {
  return <Row icon={<SeverityIcon severity={severity} size={20} />} iconColor="transparent" label={word} value={<span className="text-[14px]">{text}</span>} />;
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ error?: string; connected?: string }> }) {
  const me = await requireUser();
  const owner = isFullOwner(me);
  const { error: connectError, connected } = await searchParams;
  const personalOn = canConnectPersonal(me);
  // Only this person's own items: getDashboard hands everyone their own personal mail alone.
  const [mine, dash] = personalOn ? await Promise.all([listPersonalSummaries(me.email).catch(() => []), getDashboard()]) : [[], null];
  const [{ businessRules, sites }, user, log, places, solar, solarTokenHash, prefs, tickOn, tickAt] = await Promise.all([getConfig(), getUser(me.email), owner ? listAudit(50) : Promise.resolve([]), getSetting<PlaceConfig[]>("places", []), solarConfig(), getSetting<string | null>("solar_ingest_token_hash", null), getPrefs(me.email), owner ? tickConfigured() : false, owner ? lastTick() : null]);
  const [passkeys, passkeysHere, fresh] = me.hasTotp ? await Promise.all([listPasskeys(me.email).catch(() => []), passkeysUsableHere().catch(() => false), readSession().then(sessionIsFresh)]) : [[], false, false];
  const homeZone = businessTimeZone();
  const myZone = prefs.timeZone ?? homeZone;
  const codesLeft = user?.recovery_codes.length ?? 0;
  const rules = formatBusinessRules(businessRules);
  const businessCount = new Set(businessRules.map((r) => r.business)).size;
  const tabs = [...(personalOn ? [["my-mail", "My mail"]] : []), ["security", "Security"], ["notifications", "Notifications"], ...(owner ? [["businesses", "Businesses"], ["solar", "Solar"], ["audit", "Audit"]] : [])];

  const msOn = oauthConfigured("microsoft");
  const googleOn = oauthConfigured("gmail");
  const myEmails = dash ? dash.emails.filter((e) => e.owner === me.email) : [];
  const myEvents = dash ? dash.calendar.filter((e) => e.owner === me.email) : [];
  const myProblems = dash?.personalProblems ?? [];
  const hasMs = mine.some((c) => c.provider === "microsoft");
  const hasGoogle = mine.some((c) => c.provider === "gmail");

  const account = (
    <Group>
      <div className="flex items-center gap-3.5 px-4 py-3.5">
        <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-gradient-to-b from-[#a1a1a6] to-[#86868b] text-[20px] font-semibold text-white">{initials(me.name, me.email)}</span>
        <div className="min-w-0">
          <div className="truncate text-[20px] font-semibold">{me.name !== me.email ? me.name : me.email}</div>
          <div className="truncate text-[14px] text-muted">{me.name !== me.email ? `${me.email} · ` : ""}{me.envOwner ? "Owner" : `${ROLE_LABEL[me.role]}${me.businesses ? ` for ${me.businesses.join(", ")}` : ""}`}</div>
        </div>
      </div>
    </Group>
  );

  const myMail = personalOn ? (
    <Group id="my-mail" header="My mail & calendar" footer={<>Sign in with your own account ({me.email}): read, organise and send your mail from the Inbox, and read your calendar. Its messages, events and the to-dos made from them are shown to <span className="text-ink">you alone</span>, not to other members or the owner, who only sees that you have one connected.{canSee(me, "inbox") ? " Mail shows in your Inbox" : ""}{canSee(me, "inbox") && canSee(me, "agenda") ? " and" : ""}{canSee(me, "agenda") ? " events in your Calendar" : ""}. Disconnecting deletes the stored sign-in.</>}>
      {connectError && <GroupBody><p className="flex items-start gap-2 text-[14px]"><SeverityIcon severity="critical" size={18} /><span><span className="mr-1.5 font-semibold text-critical">Couldn&apos;t connect.</span>{connectError}</span></p></GroupBody>}
      {connected && <GroupBody className="text-[14px] text-ok">✓ Connected {connected}. Your mail and events show up within a minute.</GroupBody>}
      {mine.map((c) => {
        const problem = myProblems.find((p) => p.account === c.account);
        return (
          <Row key={c.id} icon={<span className="text-[13px] font-bold">{c.provider === "microsoft" ? "M" : "G"}</span>} iconColor={c.provider === "microsoft" ? SYS.blue : SYS.cyan} label={c.account}
            sub={<>
              {c.provider === "microsoft" ? "Microsoft 365" : "Google"} · connected {timeAgo(c.createdAt)}
              {(c.provider === "microsoft" || c.scopes) && <MailAccessChips provider={c.provider === "microsoft" ? "outlook" : "gmail"} scopes={c.scopes} />}
              {problem && <span className="mt-1 flex items-start gap-1.5 break-words"><SeverityIcon severity="high" size={14} /><span className="text-ink"><span className="mr-1 font-semibold text-warn">High</span>{problem.error} Reconnect below.</span></span>}
            </>}>
            <DisconnectMineButton id={c.id} name={c.account} />
          </Row>
        );
      })}
      {mine.length > 0 && <Row label="Unread · last 14 days" value={myEmails.filter((e) => e.unread).length} />}
      {mine.length > 0 && <Row label="Events · next 7 days" value={myEvents.length} />}
      {msOn && <Row icon={<Mail size={16} />} iconColor={SYS.blue} label={<span className="text-cyan">{hasMs ? "Reconnect Microsoft" : "Connect my Microsoft 365"}</span>} href="/api/connect/microsoft?mine=1" />}
      {googleOn && <Row icon={<Mail size={16} />} iconColor={SYS.cyan} label={<span className="text-cyan">{hasGoogle ? "Reconnect Google" : "Connect my Google"}</span>} href="/api/connect/gmail?mine=1" />}
      {!msOn && !googleOn && <GroupBody className="text-muted">Mailbox sign-in isn&apos;t set up on this dashboard yet. Ask the owner.</GroupBody>}
    </Group>
  ) : null;

  const security = (
    <div id="security" className="grid scroll-mt-24 gap-7">
      <Group header="Security" footer={me.hasTotp ? undefined : require2fa() ? undefined : "Optional because REQUIRE_2FA=false."}>
        <Row icon={<ShieldCheck size={17} />} iconColor={me.hasTotp ? SYS.green : SYS.orange} label="Two-factor authentication"
          sub={me.hasTotp ? `Since ${new Date(user!.totp_enabled_at!).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : "Off: anyone with your password can sign in."}
          value={me.hasTotp ? "On" : <span className="font-medium text-warn">Off</span>} />
        {!me.hasTotp && <Row label={<span className="text-cyan">Turn on two-factor authentication</span>} href="/login/2fa/setup" />}
        {me.hasTotp && (
          <Row icon={<KeyRound size={16} />} iconColor={SYS.gray} label="Recovery codes" value={<span className={codesLeft <= 2 ? "font-medium text-warn" : ""}>{codesLeft} of {RECOVERY_TOTAL} left</span>} />
        )}
      </Group>
      {me.hasTotp && (
        <>
          <Group header={<>Passkeys · {passkeys.length ? `${passkeys.length} added` : "none yet"}</>}>
            <GroupBody><PasskeyManager passkeys={passkeys} fresh={fresh} available={passkeysHere} /></GroupBody>
          </Group>
          <Group header="New recovery codes" footer={`Enter a current code to make ${RECOVERY_TOTAL} new ones. The old ones stop working.`}>
            <GroupBody><RegenerateCodesForm /></GroupBody>
          </Group>
          <Group header="Lost your authenticator?" footer="Resetting removes 2FA and signs out everywhere; you'll set it up again at next sign-in.">
            <GroupBody><ResetTwoFactorForm /></GroupBody>
          </Group>
        </>
      )}
      {sharedLoginLimitWarning() && (
        <Group header="Sign-in rate limit">
          <GroupBody><p className="flex items-start gap-2 text-[14px]"><SeverityIcon severity="high" size={18} /><span><span className="mr-1.5 font-semibold text-warn">High</span>{sharedLoginLimitWarning()}</span></p></GroupBody>
        </Group>
      )}
      <Group header="Sessions" footer="Signs this account out on every browser and phone, including this one.">
        <form action={signOutEverywhere}>
          <button className="flex min-h-11 w-full items-center gap-3 px-4 py-2.5 text-left text-[15px] text-critical transition-colors hover:bg-fill">
            <IconTile color={SYS.red}><LogOut size={16} /></IconTile>Sign out of all devices
          </button>
        </form>
      </Group>
    </div>
  );

  const tickFresh = tickAt && Date.now() - Date.parse(tickAt) < 15 * 60_000;
  const notifications = (
    <div id="notifications" className="grid scroll-mt-24 gap-7">
      <Group header="Notifications" footer="Alerts arrive as push notifications on this phone or computer, only for items you can see and tasks assigned to you. Install the dashboard (Add to Home Screen) for the best experience.">
        <PushToggle publicKey={vapidPublicKey()} />
      </Group>
      <NotifyPrefsForm prefs={prefs} zones={timeZones(prefs.timeZone, homeZone)} businessZone={homeZone} />
      <Group header="Pause non-critical" footer="High alerts wait until the pause ends; critical ones still come through.">
        <GroupBody><PauseButtons pausedUntil={prefs.pausedUntil} timeZone={myZone} /></GroupBody>
      </Group>
      <Group header="What you get" footer={<>Website outages are confirmed by a second check a few minutes later. More than 5 pushes in 10 minutes are combined into one. History: the bell, and the <Link href="/notifications#delivery" className="text-cyan hover:underline">delivery log</Link>.</>}>
        <SevRow severity="critical" word="Critical" text="At once, always" />
        <SevRow severity="high" word="High" text="At once, held in quiet hours" />
        <SevRow severity="medium" word="Medium" text="One noon digest" />
        <SevRow severity="low" word="Low" text="No push; in the morning brief" />
      </Group>
      {owner && (
        <Group header="Instant alerts · scheduler link" footer={<>Keep the token private: it can only trigger a check, nothing else. Prefer the header: a token inside the URL (the fallback, for schedulers without headers) can end up in access logs. Replacing it stops the old one. <C>Authorization: Bearer CRON_SECRET</C> works on <C>/api/tick</C> too.</>}>
          <Row label="Every 5 minutes" sub="Vercel's free plan checks the platforms once a day. A free scheduler calling this link every 5 minutes makes alerts (and website checks) near-instant."
            value={tickOn ? (tickFresh ? <span className="text-ok">Running · {timeAgo(tickAt)}</span> : <span className="text-warn">{tickAt ? `Last call ${timeAgo(tickAt)}` : "Never called"}</span>) : "Not set up"} />
          <GroupBody>
            <SchedulerLinkForm exists={tickOn} />
            <ol className="mt-3 grid list-decimal gap-1 pl-5 text-[14px] text-muted marker:text-muted">
              <li>Click <span className="text-ink">Create scheduler link</span>; copy the URL and the header value (shown once).</li>
              <li>Sign up free at <a href="https://cron-job.org" target="_blank" rel="noreferrer" className="text-cyan hover:underline">cron-job.org</a> → <span className="text-ink">Create cronjob</span>.</li>
              <li>Paste the URL; schedule <span className="text-ink">Every 5 minutes</span>.</li>
              <li>Under <span className="text-ink">Advanced → Headers</span>, add key <C>Authorization</C> with the value <C>Bearer tick_…</C>; set the timeout to 60 seconds. Save.</li>
              <li>Come back here in 10 minutes: this section shows when it was last called.</li>
            </ol>
          </GroupBody>
        </Group>
      )}
      {owner && (
        <Group header={<>Morning brief by email · {briefHour()}:00 ({env("BUSINESS_TIMEZONE") ?? "UTC"})</>} footer={<>Weekly reports go out on Mondays; see <Link href="/reports" className="text-cyan hover:underline">Reports</Link>. Alerts never go by email.</>}>
          <Row label="Morning brief" sub={emailEnabled() ? `To ${env("BRIEF_EMAIL_TO")}` : <>Set <C>RESEND_API_KEY</C>, <C>BRIEF_EMAIL_FROM</C> and <C>BRIEF_EMAIL_TO</C>.</>} value={emailEnabled() ? <span className="text-ok">On</span> : "Off"} />
          <Row label="Resend" href="/platforms#resend"><Tag color={emailEnabled() ? SYS.green : SYS.gray}>{emailEnabled() ? "On" : "Off"}</Tag></Row>
          <Row label="Weekly report" value="Mondays" />
        </Group>
      )}
    </div>
  );

  const ownerConfig = owner ? (
    <>
      <Group id="businesses" header={<>Businesses · {businessCount} businesses, {businessRules.length} rules</>} footer={<>One rule per line: <C>name fragment = Business</C>. Repos, projects and databases whose name contains the fragment are grouped under that business.</>}>
        <GroupBody><BusinessRulesForm initial={rules} /></GroupBody>
      </Group>
      <Group id="websites" header={<>Websites · {sites.length} sites, probed every 5 min</>} footer={<>One site per line: <C>domain | Business | Supabase project ref (optional)</C>. With a project ref, sign-ups are counted from its auth users.</>}>
        <GroupBody><WebsitesForm initial={formatSites(sites)} /></GroupBody>
      </Group>
      <Group id="places" header="Google Business listings" footer={<>One per line: <C>place ID | Business</C>. Find a place ID with Google&apos;s Place ID Finder. Needs <C>GOOGLE_PLACES_API_KEY</C>{process.env.GOOGLE_PLACES_API_KEY ? " (set)" : " (not set yet)"}.</>}>
        <GroupBody><PlacesForm initial={places.map((p) => `${p.placeId} | ${p.business}`).join("\n")} /></GroupBody>
      </Group>
      <Group id="solar" header="Solar" footer={<>Readings are pushed to <C>/api/ingest/solar</C> with <C>Authorization: Bearer &lt;token&gt;</C>. One line per station: <C>station id = Business</C>.</>}>
        <Row label="Ingest token" sub={env("SOLAR_INGEST_TOKEN") ? "Set via SOLAR_INGEST_TOKEN; you can add a second one here." : solarTokenHash ? "A token exists (only its hash is stored)." : "None yet: create one to start."}>
          <SolarTokenForm exists={!!solarTokenHash} />
        </Row>
        <GroupBody>
          <SolarForm initial={{ daylightFrom: solar.daylightFrom, daylightTo: solar.daylightTo, offlineAfterMin: solar.offlineAfterMin, lowBatteryPct: solar.lowBatteryPct, stations: Object.entries(solar.businesses).map(([k, v]) => `${k} = ${v}`).join("\n") }} />
        </GroupBody>
      </Group>
      <Group id="audit" header={<>Audit log · last {log.length}</>}>
        {log.length === 0 ? <GroupBody className="text-center text-muted">Nothing recorded yet.</GroupBody> : (
          <ul className="max-h-[36rem] overflow-y-auto [&>li+li]:border-t [&>li+li]:border-line">
            {log.map((e) => (
              <li key={e.id} className="grid grid-cols-[64px_1fr] gap-3 px-4 py-2.5 text-[14px] sm:grid-cols-[84px_1fr]">
                <span className="pt-0.5 text-[13px] tabular-nums text-muted">{timeAgo(e.at)}</span>
                <span className="min-w-0 break-words">
                  <C>{e.action}</C>
                  {e.target ? <span> · {e.target}</span> : null}
                  <span className="block text-[13px] text-muted">{e.actor}{e.ip ? ` · ${e.ip}` : ""}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Group>
    </>
  ) : null;

  return (
    <>
      <PageHeader title="Settings" subtitle={`Signed in as ${me.email}`} />
      <nav aria-label="Settings sections" className="no-scrollbar -mx-4 mb-6 flex gap-2 overflow-x-auto px-4 lg:mx-0 lg:px-0">
        {tabs.map(([id, label]) => <a key={id} href={`#${id}`} className="inline-flex min-h-9 shrink-0 items-center rounded-full bg-panel px-3.5 text-[14px] font-medium text-ink shadow-[0_0_0_1px_var(--color-line)] hover:bg-panel-2">{label}</a>)}
      </nav>

      <div className={`grid items-start gap-7 ${owner ? "xl:grid-cols-2 xl:gap-8" : "max-w-[720px]"}`}>
        <Groups>
          {account}
          {myMail}
          {security}
          {notifications}
        </Groups>
        {owner && <Groups>{ownerConfig}</Groups>}
      </div>
    </>
  );
}
