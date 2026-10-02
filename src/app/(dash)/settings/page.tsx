import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { isFullOwner, ROLE_LABEL } from "@/lib/access";
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

export default async function SettingsPage() {
  const me = await requireUser();
  const owner = isFullOwner(me);
  const [{ businessRules, sites }, user, log, places, solar, solarTokenHash] = await Promise.all([getConfig(), getUser(me.email), owner ? listAudit(50) : Promise.resolve([]), getSetting<PlaceConfig[]>("places", []), solarConfig(), getSetting<string | null>("solar_ingest_token_hash", null)]);
  const codesLeft = user?.recovery_codes.length ?? 0;
  const rules = formatBusinessRules(businessRules);
  const businessCount = new Set(businessRules.map((r) => r.business)).size;
  const tabs = owner ? [["businesses", "Businesses"], ["security", "Security"], ["notifications", "Notifications"], ["solar", "Solar"], ["audit", "Audit"]] : [["security", "Security"], ["notifications", "Notifications"]];

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

  const notifications = (
    <HeadPanel id="notifications" accent="#ff5fd7" title="Notifications" status={<span className="hud-label text-[11px] tracking-[0.12em] text-muted">push{owner ? " · email" : ""}</span>} bodyClassName="!p-0">
      <div className="px-4 py-4 sm:px-5">
        <p className="mb-3 text-[13px] text-muted">Push notifications reach this phone or computer for new critical items you can see and tasks assigned to you{owner ? ", plus the morning brief" : ""}. Install the dashboard (Add to Home Screen) for the best experience.</p>
        <PushToggle publicKey={vapidPublicKey()} />
      </div>
      {owner && (
        <Sub title={<>Morning brief by email · {briefHour()}:00 ({env("BUSINESS_TIMEZONE") ?? "UTC"})</>}>
          <p className="text-[13px] text-muted">
            {emailEnabled() ? <><span className="text-emerald">On</span>, to {env("BRIEF_EMAIL_TO")}.</> : <>Off. Set <C>RESEND_API_KEY</C>, <C>BRIEF_EMAIL_FROM</C> and <C>BRIEF_EMAIL_TO</C>.</>} Weekly reports go out on Mondays; see <Link href="/reports" className="text-cyan hover:underline">Reports</Link>.
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
          {security}
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
