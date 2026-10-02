import { getDashboard } from "@/lib/server/dashboard";
import { clientIpVerifiable, require2fa, requireUser, requireSection } from "@/lib/server/auth";
import { ACCOUNT_CHECKLIST, CONFIRMATION_VALID_DAYS } from "@/lib/security-checklist";
import { daysBetween, today } from "@/lib/dates";
import { env } from "@/lib/source";
import { Card, Empty, PageHeader, SeverityBadge, StatusDot, timeAgo } from "@/components/ui";
import { ChecklistToggle } from "@/components/records";

export default async function SecurityPage() {
  await requireSection("security");
  const me = await requireUser();
  const d = await getDashboard();
  const now = today();
  const s = d.security;
  const advisories = d.databases.flatMap((db) => (db.advisories ?? []).map((a) => ({ ...a, db })));
  const hardening = [
    { ok: me.hasTotp, label: "Two-factor sign-in on your dashboard account" },
    { ok: require2fa(), label: "2FA required for every sign-in (REQUIRE_2FA)" },
    { ok: !!env("ENCRYPTION_KEY"), label: "Stored credentials encrypted with your own ENCRYPTION_KEY" },
    { ok: clientIpVerifiable() || process.env.NODE_ENV !== "production", label: "Client IPs verifiable for per-IP sign-in limits (Vercel or TRUSTED_PROXY)" },
    { ok: !!env("CRON_SECRET"), label: "Scheduled checks enabled (CRON_SECRET)" },
  ];

  return (
    <>
      <PageHeader mode={d.modes.security} title="Security" subtitle="Vulnerable dependencies, leaked secrets, database findings and two-factor sign-in across your accounts." />

      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Code alerts" action={<span className="text-xs text-muted">{s.alerts.length} open</span>}>
          {s.alerts.length === 0 ? <Empty>No open Dependabot or secret-scanning alerts.</Empty> : (
            <ul className="-my-2 divide-y divide-line">
              {s.alerts.map((a) => (
                <li key={`${a.repo}-${a.kind}-${a.number}`} className="flex items-start gap-3 py-2.5">
                  <SeverityBadge severity={a.severity} />
                  <div className="min-w-0 flex-1">
                    <a href={a.url} target="_blank" rel="noreferrer" className="text-sm hover:text-accent">{a.title}</a>
                    <div className="text-xs text-muted">{a.repo} · {a.kind === "secret" ? "secret scanning" : "Dependabot"} · {timeAgo(a.createdAt)}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {s.repos.length > 0 && (
            <details className="mt-4 border-t border-line pt-3">
              <summary className="cursor-pointer text-xs text-accent">Coverage across {s.repos.length} repos</summary>
              <ul className="mt-2 space-y-1 text-xs">
                {s.repos.map((r) => (
                  <li key={r.repo} className="flex justify-between gap-2">
                    <span className="truncate">{r.repo}</span>
                    <span className="shrink-0 text-muted">Dependabot <span className={r.dependabot === "off" ? "text-high" : ""}>{r.dependabot}</span> · secrets {r.secretScanning}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </Card>

        <Card title="Database findings" action={<span className="text-xs text-muted">Supabase advisors</span>}>
          {advisories.length === 0 ? <Empty>No advisor findings.</Empty> : (
            <ul className="-my-2 divide-y divide-line">
              {advisories.map((a, i) => (
                <li key={i} className="flex items-start gap-3 py-2.5">
                  <SeverityBadge severity={a.level} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm">{a.title}</div>
                    <div className="text-xs text-muted">{a.db.name}{a.db.business ? ` · ${a.db.business}` : ""}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={<span id="checklist">Two-factor sign-in on your accounts</span>}>
          <ul className="-my-2 divide-y divide-line text-sm">
            <li className="flex items-center justify-between gap-3 py-2.5">
              <span className="flex items-center gap-2">
                <StatusDot status={s.github2fa === true ? "ok" : s.github2fa === false ? "bad" : "idle"} />
                GitHub{s.githubLogin ? ` (${s.githubLogin})` : ""}
              </span>
              <span className="text-xs text-muted">{s.github2fa === true ? "verified automatically" : s.github2fa === false ? <a href="https://github.com/settings/security" target="_blank" rel="noreferrer" className="text-critical hover:underline">off: turn it on</a> : "can't tell from this token"}</span>
            </li>
            {ACCOUNT_CHECKLIST.map((item) => {
              const at = d.records.checklist[item.id];
              const fresh = !!at && daysBetween(at.slice(0, 10), now) < CONFIRMATION_VALID_DAYS;
              const used = (d.modes as Record<string, string>)[item.usedWhen] === "live";
              return (
                <li key={item.id} className="flex items-center justify-between gap-3 py-2.5">
                  <span className="flex min-w-0 items-center gap-2">
                    <StatusDot status={fresh ? "ok" : used ? "warn" : "idle"} />
                    <span className="truncate">{item.url ? <a href={item.url} target="_blank" rel="noreferrer" className="hover:text-accent">{item.name}</a> : item.name}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2 text-xs text-muted">
                    {fresh ? `confirmed ${timeAgo(at)}` : at ? "re-check (over a year)" : used ? "not confirmed" : "not connected"}
                    <ChecklistToggle id={item.id} confirmed={fresh} />
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-xs text-muted">These platforms don&apos;t report 2FA through their APIs, so you confirm each one. Confirmations expire after a year.</p>
        </Card>

        <Card title="This dashboard">
          <ul className="space-y-2 text-sm">
            {hardening.map((h) => (
              <li key={h.label} className="flex items-start gap-2"><span className="mt-1.5"><StatusDot status={h.ok ? "ok" : "warn"} /></span><span className={h.ok ? "" : "text-high"}>{h.label}</span></li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
