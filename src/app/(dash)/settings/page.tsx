import Link from "next/link";
import { isFullOwner, ROLE_LABEL } from "@/lib/access";
import { signOutEverywhere } from "@/app/actions/auth";
import { requireUser, require2fa, sharedLoginLimitWarning } from "@/lib/server/auth";
import { formatBusinessRules, formatSites, getConfig } from "@/lib/server/config";
import { listAudit } from "@/lib/server/store/audit";
import { getUser } from "@/lib/server/store/users";
import { Card, PageHeader, timeAgo } from "@/components/ui";
import { PlacesForm } from "@/components/pipeline";
import { getSetting } from "@/lib/server/store/settings";
import type { PlaceConfig } from "@/lib/connectors/reviews";
import { BusinessRulesForm, RegenerateCodesForm, ResetTwoFactorForm, SolarForm, SolarTokenForm, WebsitesForm } from "@/components/settings/forms";
import { PushToggle } from "@/components/settings/PushToggle";
import { solarConfig } from "@/lib/server/solar-store";
import { emailEnabled, vapidPublicKey } from "@/lib/server/notify";
import { briefHour } from "@/lib/server/reports";
import { env } from "@/lib/source";

export default async function SettingsPage() {
  const me = await requireUser();
  const owner = isFullOwner(me);
  const [{ businessRules, sites }, user, log, places, solar, solarTokenHash] = await Promise.all([getConfig(), getUser(me.email), owner ? listAudit(50) : Promise.resolve([]), getSetting<PlaceConfig[]>("places", []), solarConfig(), getSetting<string | null>("solar_ingest_token_hash", null)]);
  return (
    <>
      <PageHeader title="Settings" subtitle={`Signed in as ${me.email}${me.envOwner ? "" : ` · ${ROLE_LABEL[me.role]}${me.businesses ? ` for ${me.businesses.join(", ")}` : ""}`}.`} />
      <div className="grid gap-6 xl:grid-cols-2">
        {owner && (<>
        <Card title="Businesses">
          <p className="mb-3 text-sm text-muted">One rule per line: <code>name fragment = Business</code>. Repos, projects and databases whose name contains the fragment are grouped under that business.</p>
          <BusinessRulesForm initial={formatBusinessRules(businessRules)} />
        </Card>
        <Card title={<span id="websites">Websites</span>}>
          <p className="mb-3 text-sm text-muted">One site per line: <code>domain | Business | Supabase project ref (optional)</code>. Each is probed every 5 minutes; with a project ref, sign-ups are counted from its auth users.</p>
          <WebsitesForm initial={formatSites(sites)} />
        </Card>
        </>)}

        <Card title="Security">
          <dl className="grid gap-4 text-sm">
            <div>
              <dt className="font-medium">Two-factor authentication</dt>
              <dd className="mt-1 text-muted">
                {me.hasTotp ? (
                  <>On since {new Date(user!.totp_enabled_at!).toLocaleDateString()}. {user!.recovery_codes.length} recovery code{user!.recovery_codes.length === 1 ? "" : "s"} left.</>
                ) : (
                  <>Off.{" "}<Link href="/login/2fa/setup" className="text-accent hover:underline">Turn it on →</Link>{require2fa() ? "" : " (Optional because REQUIRE_2FA=false.)"}</>
                )}
              </dd>
            </div>
            {me.hasTotp && (
              <>
                <div>
                  <dt className="mb-2 font-medium">Recovery codes</dt>
                  <dd><RegenerateCodesForm /></dd>
                </div>
                <div>
                  <dt className="mb-1 font-medium">Lost your authenticator?</dt>
                  <dd className="mb-2 text-xs text-muted">Resetting removes 2FA and signs out everywhere; you&apos;ll set it up again at next sign-in.</dd>
                  <dd><ResetTwoFactorForm /></dd>
                </div>
              </>
            )}
            {sharedLoginLimitWarning() && (
              <div>
                <dt className="font-medium">Sign-in rate limit</dt>
                <dd className="mt-1 text-high">{sharedLoginLimitWarning()}</dd>
              </div>
            )}
            <div>
              <dt className="mb-2 font-medium">Sessions</dt>
              <dd>
                <form action={signOutEverywhere}>
                  <button className="rounded-lg border border-line px-3 py-1.5 text-sm hover:border-accent/50">Sign out of all devices</button>
                </form>
              </dd>
            </div>
          </dl>
        </Card>

        {owner && (
        <Card title={<span id="places">Google Business listings</span>}>
          <p className="mb-3 text-sm text-muted">One per line: <code>place ID | Business</code>. Find a place ID with Google&apos;s Place ID Finder. Needs <code>GOOGLE_PLACES_API_KEY</code>{process.env.GOOGLE_PLACES_API_KEY ? " (set)" : " (not set yet)"}.</p>
          <PlacesForm initial={places.map((p) => `${p.placeId} | ${p.business}`).join("\n")} />
        </Card>
        )}

        <Card title={<span id="notifications">Notifications</span>}>
          <p className="mb-3 text-sm text-muted">Push notifications reach this phone or computer for new critical items you can see and tasks assigned to you{owner ? ", plus the morning brief" : ""}. Install the dashboard (Add to Home Screen) for the best experience.</p>
          <PushToggle publicKey={vapidPublicKey()} />
          {owner && <p className="mt-4 text-sm text-muted">
            Morning brief by email at {briefHour()}:00 ({env("BUSINESS_TIMEZONE") ?? "UTC"}): {emailEnabled() ? <span className="text-ok">on, to {env("BRIEF_EMAIL_TO")}</span> : <>off. Set <code>RESEND_API_KEY</code>, <code>BRIEF_EMAIL_FROM</code> and <code>BRIEF_EMAIL_TO</code>.</>} Weekly reports go out on Mondays; see <Link href="/reports" className="text-accent hover:underline">Reports</Link>.
          </p>}
        </Card>

        {owner && (
        <Card title={<span id="solar">Solar</span>}>
          <p className="mb-3 text-sm text-muted">Readings are pushed to <code>/api/ingest/solar</code> with <code>Authorization: Bearer &lt;token&gt;</code>. {env("SOLAR_INGEST_TOKEN") ? "A token is set via SOLAR_INGEST_TOKEN; you can add a second one here." : solarTokenHash ? "A token exists." : "Create a token to start."} One line per station below: <code>station id = Business</code>.</p>
          <div className="mb-4"><SolarTokenForm exists={!!solarTokenHash} /></div>
          <SolarForm initial={{ daylightFrom: solar.daylightFrom, daylightTo: solar.daylightTo, offlineAfterMin: solar.offlineAfterMin, lowBatteryPct: solar.lowBatteryPct, stations: Object.entries(solar.businesses).map(([k, v]) => `${k} = ${v}`).join("\n") }} />
        </Card>
        )}

        {owner && <Card title="Audit log" action={<span className="text-xs text-muted">last 50</span>}>
          <ul className="-my-2 max-h-[28rem] divide-y divide-line overflow-y-auto text-sm">
            {log.map((e) => (
              <li key={e.id} className="flex items-baseline gap-3 py-2">
                <span className="w-16 shrink-0 text-xs text-muted">{timeAgo(e.at)}</span>
                <span className="min-w-0 flex-1 break-words">
                  <code className="text-xs text-accent">{e.action}</code>
                  {e.target ? <span className="text-muted"> · {e.target}</span> : null}
                  <span className="block text-xs text-muted">{e.actor}{e.ip ? ` · ${e.ip}` : ""}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>}
      </div>
    </>
  );
}
