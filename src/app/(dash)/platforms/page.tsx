import type { ReactNode } from "react";
import { headers } from "next/headers";
import { ChevronRight } from "lucide-react";
import { requireOwner, requireUser } from "@/lib/server/auth";
import { getDashboard } from "@/lib/server/dashboard";
import { configStatus, PLATFORM_DEFS } from "@/lib/platforms";
import { oauthConfigured } from "@/lib/server/connect";
import { listConnectionSummaries, listPersonalSummaries, MULTI_ACCOUNT } from "@/lib/server/store/connections";
import { listMembers } from "@/lib/server/store/team";
import { DisconnectPersonalButton } from "@/components/settings/MyMail";
import { MailAccessChips } from "@/components/mail/bits";
import { getSetting, lastRun } from "@/lib/server/store/settings";
import { WEBHOOK_ENV } from "@/lib/server/webhooks";
import { hasGoogleScope, type GoogleFeature } from "@/lib/server/google";
import { env, samplesEnabled } from "@/lib/source";
import { btn, Empty, Group, PageHeader, Row, SectionTitle, SeverityIcon, SYS, Tag, timeAgo } from "@/components/ui";
import { DisconnectButton, GoogleCloudForm, RelabelForm, TokenForm, WebhookSecretForm } from "@/components/platforms/forms";
import { ConsoleCards, ConsoleStrip } from "@/components/platforms/consoles";
import { emptyBills } from "@/lib/billing/spend";
import { msClient } from "@/lib/server/microsoft";
import { CodeBox, Monogram } from "@/components/admin/bits";
import type { SourceMode } from "@/lib/types";

const WEBHOOK_HELP: Record<string, string> = {
  github: "Repo or org → Settings → Webhooks. Content type application/json. Events: workflow runs, pull requests, issues, pushes, Dependabot alerts, secret scanning alerts, deployment statuses.",
  vercel: "Team → Settings → Webhooks. Events: deployment created / succeeded / error / canceled. Paste the secret Vercel shows you.",
  stripe: "Developers → Webhooks → Add endpoint. Events: charge.dispute.*, invoice.payment_failed, invoice.paid, payout.failed, radar.early_fraud_warning.created, charge.succeeded, charge.failed. Paste the whsec_… signing secret.",
  supabase: "Project → Database → Webhooks (e.g. on auth.users INSERT). Add an HTTP header x-webhook-secret with the secret. Append ?site=yourdomain.com to the URL.",
  hikvision: "On the NVR: Configuration → Network → Advanced → Alarm Server (HTTP Listening). Host: your dashboard's domain, port 443, HTTPS, URL: the path above with your secret and the site id from Cameras. Then tick \"Notify surveillance center\" on the events you want (video loss, HDD error, illegal login, motion).",
};
const WEBHOOK_NAME = { github: "GitHub", vercel: "Vercel", stripe: "Stripe", supabase: "Supabase", hikvision: "Hikvision NVR alarms" } as const;

/** Card order on the page (others follow in definition order). */
const ORDER = ["microsoft", "msadmin", "gcloud", "github", "vercel", "supabase", "cloudflare", "stripe", "websites", "hikvision", "solar", "resend", "gmail", "claude", "reviews"];

const GOOGLE_FEATURES: [GoogleFeature, string][] = [["gmail", "Gmail"], ["calendar", "Calendar"], ["analytics", "Analytics"], ["searchConsole", "Search Console"]];

const chip = (on: boolean | null) => `rounded-full px-2 py-0.5 text-[12px] font-medium ${on ? "bg-ok/12 text-ok" : "bg-fill text-muted line-through"}`;

function GoogleGrants({ scopes }: { scopes: string[] | null }) {
  if (!scopes) return <div className="mt-1 text-[13px] text-muted">Connected before permissions were recorded. Reconnect to add Calendar, Analytics and Search Console.</div>;
  const missing = GOOGLE_FEATURES.filter(([f]) => !hasGoogleScope(scopes, f));
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      {GOOGLE_FEATURES.map(([f, label]) => <span key={f} className={chip(hasGoogleScope(scopes, f))}>{label}</span>)}
      {missing.length > 0 && <span className="text-[12px] text-muted">Reconnect to grant the rest.</span>}
    </div>
  );
}

function MsAdminSummary({ bills }: { bills: ReturnType<typeof emptyBills> }) {
  const m = bills.microsoft;
  const paid = m.licences.filter((l) => !l.free);
  const unassigned = paid.reduce((n, l) => n + l.unassigned, 0);
  return (
    <div className="mt-1 text-[13px] text-muted">
      {paid.length > 0 && <span>{paid.reduce((n, l) => n + l.purchased, 0)} paid seats, {unassigned} unassigned · </span>}
      {m.health.length > 0 ? <span className="text-warn">{m.health.length} open service issue{m.health.length === 1 ? "" : "s"} · </span> : null}
      {m.billing.error ? <span className="text-warn">Billing: {m.billing.error}</span> : m.billing.accounts.length ? <span>Billing: {m.billing.invoices.length} invoices in 12 months</span> : <span>Billing not read yet</span>}
      {m.healthNote && <span className="mt-1 block">{m.healthNote}</span>}
    </div>
  );
}

function GcloudSummary({ bills, table }: { bills: ReturnType<typeof emptyBills>; table: string | null }) {
  const g = bills.google;
  return (
    <div className="mt-1 text-[13px] text-muted">
      {g.projects.length} project{g.projects.length === 1 ? "" : "s"} ({g.projects.filter((p) => p.firebase).length} Firebase) · {g.billingAccounts.length} billing account{g.billingAccounts.length === 1 ? "" : "s"} · {table ? <span className="font-mono text-[12.5px]">{table}</span> : "no billing export table"}
      {g.export.error && <div className={g.export.status === "error" ? "text-warn" : ""}>{g.export.error}</div>}
    </div>
  );
}

/** The status word on the right of a connection row, like iOS Settings ("Connected", "Off"). */
function StatusWord({ mode }: { mode: SourceMode | "on" | "off" | null }) {
  if (mode === "live") return <span className="text-[15px] text-ok">Connected</span>;
  if (mode === "on") return <span className="text-[15px] text-ok">On</span>;
  if (mode === "error") return <span className="text-[15px] font-medium text-critical">Error</span>;
  if (mode === "off") return <span className="text-[15px] text-muted">Off</span>;
  return <span className="text-[15px] text-muted">{samplesEnabled() ? "Sample data" : "Not connected"}</span>;
}

/**
 * One expandable iOS-Settings-style row: tile, name, muted subtitle, status
 * word, an optional quick action, and a chevron that turns when it opens.
 */
function ConnectionRow({ id, icon, name, sub, status, action, open, children }: { id?: string; icon: ReactNode; name: ReactNode; sub?: ReactNode; status: ReactNode; action?: ReactNode; open?: boolean; children: ReactNode }) {
  return (
    <details id={id} className="group/c scroll-mt-24" open={open || undefined}>
      <summary className="flex min-h-[56px] cursor-pointer list-none items-center gap-3 px-4 py-2.5 transition-colors hover:bg-fill [&::-webkit-details-marker]:hidden">
        {icon}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] leading-snug text-ink">{name}</div>
          {sub && <div className="truncate text-[13px] leading-snug text-muted">{sub}</div>}
        </div>
        <span className="hidden shrink-0 sm:inline">{status}</span>
        {action}
        <ChevronRight size={18} className="shrink-0 text-low/70 transition-transform group-open/c:rotate-90" aria-hidden />
      </summary>
      <div className="grid gap-3 border-t border-line bg-panel-2/40 px-4 py-4 text-[15px] sm:pl-[60px] sm:pr-5">
        <div className="sm:hidden">{status}</div>
        {children}
      </div>
    </details>
  );
}

const connectPill = "inline-flex min-h-8 shrink-0 items-center rounded-full bg-cyan px-3.5 text-[13px] font-semibold text-white transition hover:brightness-110 active:opacity-80";

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
  const linkCls = "inline-flex min-h-10 items-center text-[15px] text-cyan hover:opacity-70 sm:min-h-8";

  return (
    <>
      <PageHeader title="Platforms" subtitle="Connect each platform once. Credentials are encrypted in your database; environment variables still work as a fallback.">
        <Tag color={SYS.green}>{counts.live} live</Tag>
        {counts.error > 0 && <Tag color={SYS.red}>{counts.error} failing</Tag>}
        <Tag color={SYS.gray}>{counts.off} not connected</Tag>
      </PageHeader>

      {error && (
        <div className="mb-5 flex items-start gap-3 rounded-[14px] bg-critical/10 px-4 py-3">
          <SeverityIcon severity="critical" size={20} />
          <p className="text-[15px] text-ink"><b className="mr-1.5 font-semibold text-critical">Couldn&apos;t connect.</b>{error}</p>
        </div>
      )}
      {connected && (
        <div className="mb-5 flex items-center gap-3 rounded-[14px] bg-ok/10 px-4 py-3">
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-ok text-[13px] font-bold text-white" aria-hidden>✓</span>
          <p className="text-[15px] text-ink"><b className="font-semibold text-ok">Connected</b> {connected}.</p>
        </div>
      )}

      <ConsoleStrip />

      <div className="grid items-start gap-7 xl:grid-cols-[minmax(0,1fr)_380px] xl:gap-8">
        <div className="grid min-w-0 gap-7 [&>*]:min-w-0">
          <Group header="Connections" footer="Tap a platform to see its accounts, permissions and connection options.">
            {defs.map((p) => {
              const icon = <Monogram id={p.id} name={p.name} />;
              if (p.configOnly) {
                const cfg = configStatus(p, has);
                return (
                  <ConnectionRow key={p.id} id={p.id} icon={icon} name={p.name} sub={cfg.on ? p.configOnly.on : p.note ?? p.configOnly.off} status={<StatusWord mode={cfg.on ? "on" : "off"} />}>
                    {p.note && <p className="text-[13px] text-muted">{p.note}</p>}
                    <p className="text-[15px] text-ink">{cfg.on ? p.configOnly.on : p.configOnly.off}</p>
                    <ul className="flex flex-wrap gap-1.5">
                      {cfg.keys.map((k) => (
                        <li key={k.key} className={`rounded-md px-1.5 py-0.5 font-mono text-[12px] ${k.set ? "bg-ok/12 text-ok" : "bg-fill text-muted"}`}>{k.set ? "✓" : "–"} {k.key}</li>
                      ))}
                    </ul>
                    <p className="text-[13px] text-muted">Set in the server environment (values are never shown here). <a href={p.docsUrl} target="_blank" rel="noreferrer" className="text-cyan hover:underline">Get a key</a></p>
                  </ConnectionRow>
                );
              }
              const mine = connections.filter((c) => c.provider === p.provider);
              const envSet = p.envKeys.length > 0 && p.envKeys.every((k) => !!env(k));
              const mode = modes[p.id];
              const problems = d.sources.filter((s) => (p.sources ?? [p.name]).includes(s.source)).flatMap((s) => (s.error ? [s.error] : (s.partial ?? []).map((x) => x.error)));
              const multi = !!p.provider && MULTI_ACCOUNT.includes(p.provider);
              const oauthOn = !!p.oauth && oauthConfigured(p.oauth);
              const sub = problems.length ? <span className="text-critical">{problems[0]}</span> : mine.length ? mine.map((c) => c.label ?? c.account).join(", ") : envSet ? "Using environment variables" : p.note;
              return (
                <ConnectionRow key={p.id} id={p.id} icon={icon} name={p.name} sub={sub} status={<StatusWord mode={mode ?? null} />} open={problems.length > 0}
                  action={!d.dbError && oauthOn && mine.length === 0 ? <a href={`/api/connect/${p.oauth}`} className={connectPill}>Connect</a> : undefined}>
                  {p.note && <p className="text-[13px] leading-snug text-muted">{p.note}</p>}
                  {problems.length > 0 && (
                    <p className="flex items-start gap-2 [overflow-wrap:anywhere] rounded-[12px] bg-critical/10 px-3 py-2 text-[13px] text-ink"><SeverityIcon severity="critical" size={16} /><span className="min-w-0">{problems.join(" · ")}</span></p>
                  )}

                  {mine.length > 0 && (
                    <ul className="overflow-hidden rounded-[12px] bg-panel shadow-[0_0_0_1px_var(--color-line)] [&>li+li]:border-t [&>li+li]:border-line">
                      {mine.map((c, i) => (
                        <li key={c.id} className="px-3.5 py-3">
                          <div className="flex items-center justify-between gap-2">
                            <span className="min-w-0 truncate text-[15px] text-ink">{c.label ?? c.account}{c.label && c.label !== c.account ? <span className="text-muted"> · {c.account}</span> : null}{!multi && i < mine.length - 1 ? <span className="text-warn"> · not in use</span> : null}</span>
                            <DisconnectButton id={c.id} name={c.label ?? c.account} />
                          </div>
                          <div className="text-[13px] text-muted">{c.business ? `${c.business} · ` : ""}connected {timeAgo(c.createdAt)}</div>
                          {p.provider === "gmail" && <GoogleGrants scopes={c.scopes} />}
                          {p.provider === "gmail" && c.scopes && <MailAccessChips provider="gmail" scopes={c.scopes} />}
                          {p.provider === "microsoft" && <MailAccessChips provider="outlook" scopes={c.scopes} />}
                          {p.provider === "msadmin" && <MsAdminSummary bills={bills} />}
                          {p.provider === "gcloud" && <GcloudSummary bills={bills} table={gcloudTable} />}
                          {multi && <RelabelForm id={c.id} label={c.label} business={c.business} />}
                        </li>
                      ))}
                    </ul>
                  )}
                  {mine.length === 0 && envSet && <p className="text-[13px] text-muted">Using environment variables ({p.envKeys.join(", ")}).</p>}

                  {!d.dbError && p.form === "gcloud" && <GoogleCloudForm connected={mine.length > 0} exportTable={gcloudTable} />}
                  {!d.dbError && (p.oauth || p.token) && (
                    <div>
                      {p.oauth && (oauthOn ? (
                        <a href={`/api/connect/${p.oauth}`} className={`${btn(mine.length && !multi ? "outline" : "solid")} min-h-10 rounded-full px-4`}>
                          {mine.length && multi ? "Connect another account" : mine.length ? "Reconnect or replace" : `Connect ${p.name}`}
                        </a>
                      ) : (
                        <p className="text-[13px] text-muted">One-click connect needs {p.oauth === "github" ? "GITHUB_OAUTH_CLIENT_ID/SECRET" : p.oauth === "gmail" ? "GOOGLE_CLIENT_ID/SECRET" : p.oauth === "microsoft" || p.oauth === "msadmin" ? "MS_CLIENT_ID/SECRET" : "VERCEL_INTEGRATION_SLUG and VERCEL_CLIENT_ID/SECRET"} (see README).</p>
                      ))}
                      {mine.length > 0 && !multi && <p className="mt-2 text-[13px] text-muted">One {p.name} account at a time: connecting another replaces this one.</p>}
                      {p.token && (
                        <details className="group/t mt-1">
                          <summary className="inline-flex min-h-10 cursor-pointer list-none items-center gap-1 text-[15px] text-cyan [&::-webkit-details-marker]:hidden">
                            {p.token.label ? (mine.length ? p.token.label.replace(/^Add an? /, "Add another ") : p.token.label) : mine.length && !multi ? "Replace with an API token" : p.oauth ? "Use an API token instead" : mine.length ? "Add another account" : "Connect with an API key"}
                            <ChevronRight size={16} className="transition-transform group-open/t:rotate-90" aria-hidden />
                          </summary>
                          <TokenForm provider={p.provider!} fields={p.token.fields} help={p.token.help} />
                        </details>
                      )}
                    </div>
                  )}
                  {p.docsUrl.startsWith("/") && <a href={p.docsUrl} className={linkCls}>{p.docsUrl === "/cameras" ? "Open Cameras" : `Configure in ${p.docsUrl.startsWith("/settings") ? "Settings" : "the app"}`}</a>}
                </ConnectionRow>
              );
            })}
          </Group>

          <Group header="Real-time webhooks" footer="Platforms push events here the moment they happen. Each needs a shared secret.">
            {(Object.keys(WEBHOOK_ENV) as (keyof typeof WEBHOOK_ENV)[]).map((p) => {
              const fromEnv = !!env(WEBHOOK_ENV[p]);
              const stored = storedSecrets[p];
              const on = fromEnv || stored;
              return (
                <ConnectionRow key={p} icon={<Monogram id={p} name={WEBHOOK_NAME[p]} />} name={WEBHOOK_NAME[p]} sub={fromEnv ? `Secret set via ${WEBHOOK_ENV[p]}` : stored ? "Secret saved" : "No secret yet"} status={<StatusWord mode={on ? "on" : "off"} />}>
                  <CodeBox>{origin}/api/webhooks/{p}{p === "hikvision" ? "/<secret>/<site-id>" : ""}</CodeBox>
                  <p className="text-[13px] leading-relaxed text-muted">{WEBHOOK_HELP[p]}</p>
                  <p className="text-[13px] text-ink">{fromEnv ? `Secret set via ${WEBHOOK_ENV[p]}.` : stored ? "Secret saved." : "No secret yet. Requests are rejected until one is set."}</p>
                  {!fromEnv && !d.dbError && <WebhookSecretForm provider={p} canGenerate={p === "github" || p === "supabase" || p === "hikvision"} />}
                </ConnectionRow>
              );
            })}
          </Group>
        </div>

        <aside className="grid min-w-0 gap-7 [&>*]:min-w-0">
          <Group
            header={`Personal mailboxes · ${personal.length} connected`}
            footer={<>Team members with Inbox or Agenda can connect their own Microsoft 365{oauthConfigured("gmail") ? " or Google" : ""} account from their Settings. Its mail, events and to-dos are visible to that person only, not on this dashboard for you. You can disconnect one here.</>}
          >
            {personal.length === 0 ? <Empty>No one has connected a personal mailbox yet.</Empty> : personal.map((c) => {
              const who = names.get(c.ownerEmail) ?? c.ownerEmail;
              return (
                <Row key={c.id} icon={<span className="text-[13px] font-bold">{c.provider === "microsoft" ? "M" : "G"}</span>} iconColor={c.provider === "microsoft" ? SYS.blue : SYS.cyan} label={who}
                  sub={<>{c.provider === "microsoft" ? "Microsoft 365" : "Google"} · {timeAgo(c.createdAt)}{(c.provider === "microsoft" || c.scopes) && <MailAccessChips provider={c.provider === "microsoft" ? "outlook" : "gmail"} scopes={c.scopes} />}</>}>
                  <DisconnectPersonalButton id={c.id} who={who} />
                </Row>
              );
            })}
          </Group>

          <Group header="Scheduled checks" footer={<>Runs on Vercel Cron via <code className="rounded-md bg-fill px-1.5 font-mono text-[12.5px] text-ink">vercel.json</code> (5-minute schedules need a Pro plan).</>}>
            <Row icon={<span className="text-[13px] font-bold">⏱</span>} iconColor={cronOn ? SYS.green : SYS.orange} label="Cron" sub={cronOn ? "Every 5 minutes · Vercel Cron" : "CRON_SECRET is not set"} value={cronOn ? (lastCron ? timeAgo(lastCron.at) : "Not run yet") : <span className="font-medium text-warn">Off</span>} />
            <Row icon={<span className="text-[13px] font-bold">↻</span>} iconColor={SYS.blue} label="Last sync" sub="Deploys · inbox · tasks" value={lastSync ? timeAgo(lastSync) : "Never"} />
            <Row icon={<span className="text-[13px] font-bold">5</span>} iconColor={SYS.gray} label="Each run" sub="Uptime probes, sync, task reconciliation, history cleanup" value="5 min" />
          </Group>
        </aside>
      </div>

      <SectionTitle className="mt-9">Consoles</SectionTitle>
      <ConsoleCards bills={bills} modes={d.modes} msadminConnected={connections.some((c) => c.provider === "msadmin")} gcloudConnected={!!gcloudConn} msAppConfigured={!!msClient()} />
    </>
  );
}
