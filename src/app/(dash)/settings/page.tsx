import Link from "next/link";
import { signOutEverywhere } from "@/app/actions/auth";
import { requireUser, require2fa, sharedLoginLimitWarning } from "@/lib/server/auth";
import { formatBusinessRules, formatSites, getConfig } from "@/lib/server/config";
import { listAudit } from "@/lib/server/store/audit";
import { getUser } from "@/lib/server/store/users";
import { Card, PageHeader, timeAgo } from "@/components/ui";
import { PlacesForm } from "@/components/pipeline";
import { getSetting } from "@/lib/server/store/settings";
import type { PlaceConfig } from "@/lib/connectors/reviews";
import { BusinessRulesForm, RegenerateCodesForm, ResetTwoFactorForm, WebsitesForm } from "@/components/settings/forms";

export default async function SettingsPage() {
  const me = await requireUser();
  const [{ businessRules, sites }, user, log, places] = await Promise.all([getConfig(), getUser(me.email), listAudit(50), getSetting<PlaceConfig[]>("places", [])]);
  return (
    <>
      <PageHeader title="Settings" subtitle={`Signed in as ${me.email}.`} />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Businesses">
          <p className="mb-3 text-sm text-muted">One rule per line: <code>name fragment = Business</code>. Repos, projects and databases whose name contains the fragment are grouped under that business.</p>
          <BusinessRulesForm initial={formatBusinessRules(businessRules)} />
        </Card>
        <Card title={<span id="websites">Websites</span>}>
          <p className="mb-3 text-sm text-muted">One site per line: <code>domain | Business | Supabase project ref (optional)</code>. Each is probed every 5 minutes; with a project ref, sign-ups are counted from its auth users.</p>
          <WebsitesForm initial={formatSites(sites)} />
        </Card>

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

        <Card title={<span id="places">Google Business listings</span>}>
          <p className="mb-3 text-sm text-muted">One per line: <code>place ID | Business</code>. Find a place ID with Google&apos;s Place ID Finder. Needs <code>GOOGLE_PLACES_API_KEY</code>{process.env.GOOGLE_PLACES_API_KEY ? " (set)" : " (not set yet)"}.</p>
          <PlacesForm initial={places.map((p) => `${p.placeId} | ${p.business}`).join("\n")} />
        </Card>

        <Card title="Audit log" action={<span className="text-xs text-muted">last 50</span>}>
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
        </Card>
      </div>
    </>
  );
}
