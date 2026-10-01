import { headers } from "next/headers";
import { requireUser } from "@/lib/server/auth";
import { getDashboard } from "@/lib/server/dashboard";
import { PLATFORM_DEFS } from "@/lib/platforms";
import { oauthConfigured } from "@/lib/server/connect";
import { listConnectionSummaries } from "@/lib/server/store/connections";
import { getSetting, lastRun } from "@/lib/server/store/settings";
import { WEBHOOK_ENV } from "@/lib/server/webhooks";
import { env } from "@/lib/source";
import { Card, ModePill, PageHeader, timeAgo } from "@/components/ui";
import { DisconnectButton, RelabelForm, TokenForm, WebhookSecretForm } from "@/components/platforms/forms";
import type { SourceMode } from "@/lib/types";

const WEBHOOK_HELP: Record<string, string> = {
  github: "Repo or org → Settings → Webhooks. Content type application/json. Events: workflow runs, pull requests, issues, pushes, Dependabot alerts, secret scanning alerts, deployment statuses.",
  vercel: "Team → Settings → Webhooks. Events: deployment created / succeeded / error / canceled. Paste the secret Vercel shows you.",
  stripe: "Developers → Webhooks → Add endpoint. Events: charge.dispute.*, invoice.payment_failed, invoice.paid, payout.failed, radar.early_fraud_warning.created, charge.succeeded, charge.failed. Paste the whsec_… signing secret.",
  supabase: "Project → Database → Webhooks (e.g. on auth.users INSERT). Add an HTTP header x-webhook-secret with the secret. Append ?site=yourdomain.com to the URL.",
};

export default async function PlatformsPage({ searchParams }: { searchParams: Promise<{ error?: string; connected?: string }> }) {
  const { error, connected } = await searchParams;
  await requireUser(); // reads the database directly below
  const d = await getDashboard();
  const h = await headers();
  const origin = env("APP_URL") ?? `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  const connections = d.dbError ? [] : await listConnectionSummaries();
  const storedSecrets = d.dbError ? {} : Object.fromEntries(await Promise.all(Object.keys(WEBHOOK_ENV).map(async (p) => [p, !!(await getSetting(`webhook_secret:${p}`, null))])));
  const lastCron = d.dbError ? null : await getSetting<{ at: string } | null>("job:last_cron", null);
  const lastSync = d.dbError ? null : await lastRun("job:sync");
  const modes: Record<string, SourceMode | null> = Object.fromEntries(d.platforms.map((p) => [p.id, p.mode]));

  return (
    <>
      <PageHeader title="Platforms" subtitle="Connect each platform once. Credentials are encrypted in your database; environment variables still work as a fallback." />
      {error && <div className="mb-4 rounded-lg border border-critical/40 bg-critical/10 px-4 py-3 text-sm text-critical">{error}</div>}
      {connected && <div className="mb-4 rounded-lg border border-ok/40 bg-ok/10 px-4 py-3 text-sm text-ok">Connected {connected}.</div>}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {PLATFORM_DEFS.filter((p) => p.available).map((p) => {
          const mine = connections.filter((c) => c.provider === p.provider);
          const envSet = p.envKeys.length > 0 && p.envKeys.every((k) => !!env(k));
          const mode = modes[p.id];
          const problems = d.sources.filter((s) => s.source === p.name).flatMap((s) => (s.error ? [s.error] : (s.partial ?? []).map((x) => x.error)));
          const multi = p.provider === "gmail";
          return (
            <Card key={p.id} title={p.name} action={mode ? <ModePill mode={mode} /> : null}>
              {p.note && <p className="text-sm text-muted">{p.note}</p>}
              {problems.length > 0 && <p className="mt-2 break-words text-xs text-critical">{problems.join(" · ")}</p>}

              {mine.length > 0 && (
                <ul className="mt-3 space-y-2 border-t border-line pt-3">
                  {mine.map((c, i) => (
                    <li key={c.id} className="text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate">{c.label ?? c.account}{c.label && c.label !== c.account ? <span className="text-muted"> · {c.account}</span> : null}{!multi && i < mine.length - 1 ? <span className="text-high"> · not in use</span> : null}</span>
                        <DisconnectButton id={c.id} name={c.label ?? c.account} />
                      </div>
                      <div className="text-xs text-muted">{c.business ? `${c.business} · ` : ""}connected {timeAgo(c.createdAt)}</div>
                      {p.provider === "gmail" && <RelabelForm id={c.id} label={c.label} business={c.business} />}
                    </li>
                  ))}
                </ul>
              )}
              {mine.length === 0 && envSet && <p className="mt-3 text-xs text-muted">Using environment variables ({p.envKeys.join(", ")}).</p>}

              {!d.dbError && (p.oauth || p.token) && (
                <div className="mt-3 border-t border-line pt-3">
                  {p.oauth && (oauthConfigured(p.oauth) ? (
                    <a href={`/api/connect/${p.oauth}`} className="inline-block rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-bg hover:opacity-90">
                      {mine.length && multi ? "Connect another mailbox" : mine.length ? "Reconnect or replace" : `Connect ${p.name}`}
                    </a>
                  ) : (
                    <p className="text-xs text-muted">One-click connect needs {p.oauth === "github" ? "GITHUB_OAUTH_CLIENT_ID/SECRET" : p.oauth === "gmail" ? "GOOGLE_CLIENT_ID/SECRET" : "VERCEL_INTEGRATION_SLUG and VERCEL_CLIENT_ID/SECRET"} (see README).</p>
                  ))}
                  {mine.length > 0 && !multi && <p className="mt-2 text-xs text-muted">One {p.name} account at a time: connecting another replaces this one.</p>}
                  {p.token && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs text-accent">{mine.length && !multi ? "Replace with an API token" : "Use an API token instead"}</summary>
                      <TokenForm provider={p.provider!} fields={p.token.fields} help={p.token.help} />
                    </details>
                  )}
                </div>
              )}
              {p.docsUrl.startsWith("/") && <a href={p.docsUrl} className="mt-3 inline-block text-xs text-accent hover:underline">Configure sites →</a>}
            </Card>
          );
        })}
      </div>

      <h2 className="mb-3 mt-10 text-sm font-semibold uppercase tracking-wider text-muted">Real-time webhooks</h2>
      <div className="grid gap-4 md:grid-cols-2">
        {(Object.keys(WEBHOOK_ENV) as (keyof typeof WEBHOOK_ENV)[]).map((p) => {
          const fromEnv = !!env(WEBHOOK_ENV[p]);
          const stored = (storedSecrets as Record<string, boolean>)[p];
          return (
            <Card key={p} title={{ github: "GitHub", vercel: "Vercel", stripe: "Stripe", supabase: "Supabase" }[p]} action={<ModePill mode={fromEnv || stored ? "live" : "demo"} />}>
              <code className="block break-all rounded bg-bg px-2 py-1 text-xs">{origin}/api/webhooks/{p}</code>
              <p className="mt-2 text-xs text-muted">{WEBHOOK_HELP[p]}</p>
              <p className="mt-2 text-xs">{fromEnv ? `Secret set via ${WEBHOOK_ENV[p]}.` : stored ? "Secret saved." : "No secret yet. Requests are rejected until one is set."}</p>
              {!fromEnv && !d.dbError && <WebhookSecretForm provider={p} canGenerate={p === "github" || p === "supabase"} />}
            </Card>
          );
        })}
      </div>

      <h2 className="mb-3 mt-10 text-sm font-semibold uppercase tracking-wider text-muted">Scheduled checks</h2>
      <Card>
        <p className="text-sm">
          Cron: {env("CRON_SECRET") ? (lastCron ? <>last run <strong>{timeAgo(lastCron.at)}</strong></> : "configured, not run yet") : <span className="text-high">CRON_SECRET is not set, so scheduled checks are off</span>}
          {" · "}Last sync: {lastSync ? timeAgo(lastSync) : "never"}
        </p>
        <p className="mt-1 text-xs text-muted">Every 5 minutes: uptime probes, deploy and inbox sync, task reconciliation, history cleanup. Runs on Vercel Cron via <code>vercel.json</code> (5-minute schedules need a Pro plan).</p>
      </Card>
    </>
  );
}
