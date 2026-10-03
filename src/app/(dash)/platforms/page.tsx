import type { CSSProperties } from "react";
import { headers } from "next/headers";
import { requireOwner, requireUser } from "@/lib/server/auth";
import { getDashboard } from "@/lib/server/dashboard";
import { configStatus, PLATFORM_DEFS } from "@/lib/platforms";
import { oauthConfigured } from "@/lib/server/connect";
import { listConnectionSummaries, listPersonalSummaries, MULTI_ACCOUNT } from "@/lib/server/store/connections";
import { listMembers } from "@/lib/server/store/team";
import { DisconnectPersonalButton } from "@/components/settings/MyMail";
import { getSetting, lastRun } from "@/lib/server/store/settings";
import { WEBHOOK_ENV } from "@/lib/server/webhooks";
import { hasGoogleScope, type GoogleFeature } from "@/lib/server/google";
import { env } from "@/lib/source";
import { btn, ModePill, PageHeader, SeverityIcon, StatStrip, Tag, timeAgo } from "@/components/ui";
import { DisconnectButton, GoogleCloudForm, RelabelForm, TokenForm, WebhookSecretForm } from "@/components/platforms/forms";
import { ConsoleCards, ConsoleStrip } from "@/components/platforms/consoles";
import { emptyBills } from "@/lib/billing/spend";
import { msClient } from "@/lib/server/microsoft";
import { CodeBox, HeadPanel, Monogram, PLATFORM_COLOR } from "@/components/admin/bits";
import { SectionRule } from "@/components/sites/bits";
import type { SourceMode } from "@/lib/types";

const WEBHOOK_HELP: Record<string, string> = {
  github: "Repo or org → Settings → Webhooks. Content type application/json. Events: workflow runs, pull requests, issues, pushes, Dependabot alerts, secret scanning alerts, deployment statuses.",
  vercel: "Team → Settings → Webhooks. Events: deployment created / succeeded / error / canceled. Paste the secret Vercel shows you.",
  stripe: "Developers → Webhooks → Add endpoint. Events: charge.dispute.*, invoice.payment_failed, invoice.paid, payout.failed, radar.early_fraud_warning.created, charge.succeeded, charge.failed. Paste the whsec_… signing secret.",
  supabase: "Project → Database → Webhooks (e.g. on auth.users INSERT). Add an HTTP header x-webhook-secret with the secret. Append ?site=yourdomain.com to the URL.",
  hikvision: "On the NVR: Configuration → Network → Advanced → Alarm Server (HTTP Listening). Host: your dashboard's domain, port 443, HTTPS, URL: the path above with your secret and the site id from Cameras. Then tick \"Notify surveillance center\" on the events you want (video loss, HDD error, illegal login, motion).",
};
const WEBHOOK_NAME = { github: "GitHub", vercel: "Vercel", stripe: "Stripe", supabase: "Supabase", hikvision: "Hikvision NVR alarms" } as const;
const WEBHOOK_COLOR = { github: "#a98bff", vercel: "#3fd0ff", stripe: "#ffd84d", supabase: "#3df5a0", hikvision: "#c6f432" } as const;

/** Card order on the page (others follow in definition order). */
const ORDER = ["microsoft", "msadmin", "gcloud", "github", "vercel", "supabase", "cloudflare", "stripe", "websites", "hikvision", "solar", "resend", "gmail", "claude", "reviews"];

const GOOGLE_FEATURES: [GoogleFeature, string][] = [["gmail", "Gmail"], ["calendar", "Calendar"], ["analytics", "Analytics"], ["searchConsole", "Search Console"]];

function GoogleGrants({ scopes }: { scopes: string[] | null }) {
  if (!scopes) return <div className="text-xs text-muted">Connected before permissions were recorded. Reconnect to add Calendar, Analytics and Search Console.</div>;
  const missing = GOOGLE_FEATURES.filter(([f]) => !hasGoogleScope(scopes, f));
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      {GOOGLE_FEATURES.map(([f, label]) => (
        <span key={f} className={`px-1.5 py-0.5 font-mono text-[10.5px] ${hasGoogleScope(scopes, f) ? "bg-emerald/10 text-emerald" : "bg-line/40 text-muted line-through"}`}>{label}</span>
      ))}
      {missing.length > 0 && <span className="text-[10.5px] text-muted">Reconnect to grant the rest.</span>}
    </div>
  );
}

function MsAdminSummary({ bills }: { bills: ReturnType<typeof emptyBills> }) {
  const m = bills.microsoft;
  const paid = m.licences.filter((l) => !l.free);
  const unassigned = paid.reduce((n, l) => n + l.unassigned, 0);
  return (
    <div className="mt-1 text-xs text-muted">
      {paid.length > 0 && <span>{paid.reduce((n, l) => n + l.purchased, 0)} paid seats, {unassigned} unassigned · </span>}
      {m.health.length > 0 ? <span className="text-high">{m.health.length} open service issue{m.health.length === 1 ? "" : "s"} · </span> : null}
      {m.billing.error ? <span className="text-high">Billing: {m.billing.error}</span> : m.billing.accounts.length ? <span>Billing: {m.billing.invoices.length} invoices in 12 months</span> : <span>Billing not read yet</span>}
    </div>
  );
}

function GcloudSummary({ bills, table }: { bills: ReturnType<typeof emptyBills>; table: string | null }) {
  const g = bills.google;
  return (
    <div className="mt-1 text-xs text-muted">
      {g.projects.length} project{g.projects.length === 1 ? "" : "s"} ({g.projects.filter((p) => p.firebase).length} Firebase) · {g.billingAccounts.length} billing account{g.billingAccounts.length === 1 ? "" : "s"} · {table ? <span className="font-mono">{table}</span> : "no billing export table"}
      {g.export.error && <div className={g.export.status === "error" ? "text-high" : ""}>{g.export.error}</div>}
    </div>
  );
}

export default async function PlatformsPage({ searchParams }: { searchParams: Promise<{ error?: string; connected?: string }> }) {
  await requireOwner();
  const { error, connected } = await searchParams;
  await requireUser(); // reads the database directly below
  const d = await getDashboard();
  const h = await headers();
  const origin = env("APP_URL") ?? `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  const connections = d.dbError ? [] : await listConnectionSummaries();
  // People's own mailboxes: who has one, never what's in it.
  const personal = d.dbError ? [] : await listPersonalSummaries();
  const names = new Map((d.dbError ? [] : await listMembers()).map((m) => [m.email, m.name ?? m.email]));
  const storedSecrets: Record<string, boolean> = d.dbError ? {} : Object.fromEntries(await Promise.all(Object.keys(WEBHOOK_ENV).map(async (p) => [p, !!(await getSetting(`webhook_secret:${p}`, null))])));
  const lastCron = d.dbError ? null : await getSetting<{ at: string } | null>("job:last_cron", null);
  const lastSync = d.dbError ? null : await lastRun("job:sync");
  const modes: Record<string, SourceMode | null> = Object.fromEntries(d.platforms.map((p) => [p.id, p.mode]));
  const has = (k: string) => !!env(k);

  const defs = PLATFORM_DEFS.filter((p) => p.available).sort((a, b) => (ORDER.indexOf(a.id) + 1 || 99) - (ORDER.indexOf(b.id) + 1 || 99));
  const state = (id: string) => {
    const p = defs.find((x) => x.id === id)!;
    if (p.configOnly) return configStatus(p, has).on ? "live" : "demo";
    return modes[id] ?? "demo";
  };
  const counts = { live: defs.filter((p) => state(p.id) === "live").length, error: defs.filter((p) => state(p.id) === "error").length, off: defs.filter((p) => state(p.id) === "demo").length };
  const cronOn = !!env("CRON_SECRET");
  const bills = d.bills ?? emptyBills();
  const gcloudConn = connections.find((c) => c.provider === "gcloud");
  const gcloudTable = gcloudConn?.exportTable ?? null;

  return (
    <>
      <PageHeader title="Platforms" subtitle="Connect each platform once. Credentials are encrypted in your database; environment variables still work as a fallback.">
        <Tag color="#3df5a0">{counts.live} live</Tag>
        {counts.error > 0 && <Tag color="#ff3d6e">{counts.error} failing</Tag>}
        <Tag color="#7f97ab">{counts.off} not connected</Tag>
      </PageHeader>

      {error && (
        <div className="hud-panel mb-5 flex items-start gap-3 px-4 py-3 sm:px-5" style={{ "--a": "#ff3d6e" } as CSSProperties}>
          <SeverityIcon severity="critical" />
          <p className="text-sm"><span className="hud-label mr-2 text-[11px] text-critical">Couldn&apos;t connect</span>{error}</p>
        </div>
      )}
      {connected && (
        <div className="hud-panel mb-5 flex items-center gap-3 px-4 py-3 sm:px-5" style={{ "--a": "#3df5a0" } as CSSProperties}>
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-emerald text-emerald shadow-[0_0_8px_#3df5a0]">✓</span>
          <p className="text-sm">Connected {connected}.</p>
        </div>
      )}

      <ConsoleStrip />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {defs.map((p) => {
          const color = PLATFORM_COLOR[p.id] ?? "#3fd0ff";
          if (p.configOnly) {
            const cfg = configStatus(p, has);
            return (
              <HeadPanel key={p.id} id={p.id} accent={color} icon={<Monogram id={p.id} name={p.name} />} title={p.name} status={<Tag color={cfg.on ? "#3df5a0" : "#7f97ab"}>{cfg.on ? "On" : "Off"}</Tag>}>
                {p.note && <p className="text-[13px] text-muted">{p.note}</p>}
                <p className="mt-3 text-sm">{cfg.on ? p.configOnly.on : p.configOnly.off}</p>
                <ul className="mt-3 flex flex-wrap gap-1.5">
                  {cfg.keys.map((k) => (
                    <li key={k.key} className={`px-1.5 py-0.5 font-mono text-[10.5px] ${k.set ? "bg-emerald/10 text-emerald" : "bg-line/40 text-muted"}`}>{k.set ? "✓" : "–"} {k.key}</li>
                  ))}
                </ul>
                <p className="mt-auto pt-4 text-xs text-muted">Set in the server environment (values are never shown here). <a href={p.docsUrl} target="_blank" rel="noreferrer" className="text-cyan hover:underline">Get a key ›</a></p>
              </HeadPanel>
            );
          }
          const mine = connections.filter((c) => c.provider === p.provider);
          const envSet = p.envKeys.length > 0 && p.envKeys.every((k) => !!env(k));
          const mode = modes[p.id];
          const problems = d.sources.filter((s) => (p.sources ?? [p.name]).includes(s.source)).flatMap((s) => (s.error ? [s.error] : (s.partial ?? []).map((x) => x.error)));
          const multi = !!p.provider && MULTI_ACCOUNT.includes(p.provider);
          return (
            <HeadPanel key={p.id} id={p.id} accent={color} icon={<Monogram id={p.id} name={p.name} />} title={p.name} status={mode ? <ModePill mode={mode} /> : null}>
              {p.note && <p className="text-[13px] text-muted">{p.note}</p>}
              {problems.length > 0 && (
                <p className="mt-2 flex items-start gap-2 break-words text-xs text-critical"><SeverityIcon severity="critical" size={14} /><span className="min-w-0">{problems.join(" · ")}</span></p>
              )}

              {mine.length > 0 && (
                <ul className="mt-3 space-y-2.5">
                  {mine.map((c, i) => (
                    <li key={c.id} className="text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate">{c.label ?? c.account}{c.label && c.label !== c.account ? <span className="text-muted"> · {c.account}</span> : null}{!multi && i < mine.length - 1 ? <span className="text-high"> · not in use</span> : null}</span>
                        <DisconnectButton id={c.id} name={c.label ?? c.account} />
                      </div>
                      <div className="text-xs text-muted">{c.business ? `${c.business} · ` : ""}connected {timeAgo(c.createdAt)}</div>
                      {p.provider === "gmail" && <GoogleGrants scopes={c.scopes} />}
                      {p.provider === "msadmin" && <MsAdminSummary bills={bills} />}
                      {p.provider === "gcloud" && <GcloudSummary bills={bills} table={gcloudTable} />}
                      {multi && <RelabelForm id={c.id} label={c.label} business={c.business} />}
                    </li>
                  ))}
                </ul>
              )}
              {mine.length === 0 && envSet && <p className="mt-3 text-xs text-muted">Using environment variables ({p.envKeys.join(", ")}).</p>}

              <div className="mt-auto pt-4">
                {!d.dbError && p.form === "gcloud" && <GoogleCloudForm connected={mine.length > 0} exportTable={gcloudTable} />}
                {!d.dbError && (p.oauth || p.token) && (
                  <>
                    {p.oauth && (oauthConfigured(p.oauth) ? (
                      <a href={`/api/connect/${p.oauth}`} className={`${btn(mine.length && !multi ? "outline" : "solid")} min-h-10 sm:min-h-0`} style={{ "--b": color } as CSSProperties}>
                        {mine.length && multi ? "Connect another account" : mine.length ? "Reconnect or replace" : `Connect ${p.name}`}
                      </a>
                    ) : (
                      <p className="text-xs text-muted">One-click connect needs {p.oauth === "github" ? "GITHUB_OAUTH_CLIENT_ID/SECRET" : p.oauth === "gmail" ? "GOOGLE_CLIENT_ID/SECRET" : p.oauth === "microsoft" || p.oauth === "msadmin" ? "MS_CLIENT_ID/SECRET" : "VERCEL_INTEGRATION_SLUG and VERCEL_CLIENT_ID/SECRET"} (see README).</p>
                    ))}
                    {mine.length > 0 && !multi && <p className="mt-2 text-xs text-muted">One {p.name} account at a time: connecting another replaces this one.</p>}
                    {p.token && (
                      <details className="mt-2 group">
                        <summary className="flex min-h-10 cursor-pointer items-center text-xs text-cyan sm:min-h-0">{p.token.label ? (mine.length ? p.token.label.replace(/^Add an? /, "Add another ") : p.token.label) : mine.length && !multi ? "Replace with an API token" : p.oauth ? "Use an API token instead" : mine.length ? "Add another account" : "Connect with an API key"} ›</summary>
                        <TokenForm provider={p.provider!} fields={p.token.fields} help={p.token.help} />
                      </details>
                    )}
                  </>
                )}
                {p.docsUrl.startsWith("/") && <a href={p.docsUrl} className="mt-2 inline-flex min-h-10 items-center text-xs text-cyan hover:underline sm:min-h-0">{p.docsUrl === "/cameras" ? "Open Cameras" : `Configure in ${p.docsUrl.startsWith("/settings") ? "Settings" : "the app"}`} ›</a>}
              </div>
            </HeadPanel>
          );
        })}
      </div>

      <SectionRule className="mt-10">Consoles</SectionRule>
      <ConsoleCards bills={bills} modes={d.modes} msadminConnected={connections.some((c) => c.provider === "msadmin")} gcloudConnected={!!gcloudConn} msAppConfigured={!!msClient()} />

      <SectionRule className="mt-10">Personal mailboxes</SectionRule>
      <HeadPanel accent="#3fd0ff" title="Personal mail & calendars" status={<Tag color={personal.length ? "#3fd0ff" : "#7f97ab"}>{personal.length} connected</Tag>} bodyClassName="!p-0">
        <p className="px-4 py-3 text-[13px] text-muted sm:px-5">Team members with Inbox or Agenda can connect their own Microsoft 365{oauthConfigured("gmail") ? " or Google" : ""} account from their Settings. Its mail, events and to-dos are visible to that person only, not on this dashboard for you. You can disconnect one here.</p>
        {personal.length > 0 && (
          <ul className="border-t border-line/60">
            {personal.map((c) => {
              const who = names.get(c.ownerEmail) ?? c.ownerEmail;
              return (
                <li key={c.id} className="flex items-center gap-3 border-b border-line/40 px-4 py-3 last:border-0 sm:px-5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm"><span className="text-ink">{who}</span> <span className="text-muted">has a personal mailbox connected</span></div>
                    <div className="text-xs text-muted">{c.provider === "microsoft" ? "Microsoft 365" : "Google"} · {timeAgo(c.createdAt)}</div>
                  </div>
                  <DisconnectPersonalButton id={c.id} who={who} />
                </li>
              );
            })}
          </ul>
        )}
      </HeadPanel>

      <SectionRule className="mt-10">Real-time webhooks</SectionRule>
      <div className="grid gap-4 md:grid-cols-2">
        {(Object.keys(WEBHOOK_ENV) as (keyof typeof WEBHOOK_ENV)[]).map((p) => {
          const fromEnv = !!env(WEBHOOK_ENV[p]);
          const stored = storedSecrets[p];
          const on = fromEnv || stored;
          return (
            <HeadPanel key={p} accent={WEBHOOK_COLOR[p]} title={WEBHOOK_NAME[p]} status={on ? <ModePill mode="live" /> : <Tag color="#7f97ab">Not set</Tag>} className={p === "hikvision" ? "md:col-span-2" : ""}>
              <CodeBox>{origin}/api/webhooks/{p}{p === "hikvision" ? "/<secret>/<site-id>" : ""}</CodeBox>
              <p className="mt-2 text-xs leading-relaxed text-muted">{WEBHOOK_HELP[p]}</p>
              <p className="mt-2 text-xs">{fromEnv ? `Secret set via ${WEBHOOK_ENV[p]}.` : stored ? "Secret saved." : "No secret yet. Requests are rejected until one is set."}</p>
              {!fromEnv && !d.dbError && <div className="mt-auto pt-1"><WebhookSecretForm provider={p} canGenerate={p === "github" || p === "supabase" || p === "hikvision"} /></div>}
            </HeadPanel>
          );
        })}
      </div>

      <SectionRule className="mt-10">Scheduled checks</SectionRule>
      <StatStrip
        items={[
          { label: "Cron", value: cronOn ? (lastCron ? timeAgo(lastCron.at) : "not run yet") : "off", tone: cronOn ? "ink" : "high", hint: cronOn ? "every 5 minutes · Vercel Cron" : "CRON_SECRET is not set" },
          { label: "Last sync", value: lastSync ? timeAgo(lastSync) : "never", hint: "deploys · inbox · tasks" },
          { label: "Each run", value: "5 min", hint: "uptime probes, sync, task reconciliation, history cleanup" },
        ]}
      />
      <p className="mt-3 text-xs text-muted">Runs on Vercel Cron via <code className="font-mono text-[#9be7ff]">vercel.json</code> (5-minute schedules need a Pro plan).</p>
    </>
  );
}
