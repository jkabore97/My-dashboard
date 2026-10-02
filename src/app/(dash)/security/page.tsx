import type { CSSProperties } from "react";
import { getDashboard, getTasksByStatus } from "@/lib/server/dashboard";
import { clientIpVerifiable, require2fa, requireUser, requireSection } from "@/lib/server/auth";
import { ACCOUNT_CHECKLIST, CONFIRMATION_VALID_DAYS } from "@/lib/security-checklist";
import { taskSection } from "@/lib/access";
import { daysBetween, formatDate, today } from "@/lib/dates";
import { env } from "@/lib/source";
import { Card, Empty, PageHeader, SeverityBadge, Tag, timeAgo } from "@/components/ui";
import { ChecklistToggle } from "@/components/records";
import { ScoreRings, PART_COLOR } from "@/components/web/ScoreRings";
import { DEPENDABOT_OFF_PENALTY, PENALTY, securityScore } from "@/components/web/logic";

const view = "hud-btn min-h-10 sm:min-h-0";

function Segments({ filled, total, color, warn = 0 }: { filled: number; total: number; color: string; warn?: number }) {
  const n = Math.max(1, Math.min(total, 12));
  const on = total ? Math.round((filled / total) * n) : 0;
  const bad = total ? Math.min(n - on, Math.ceil((warn / total) * n)) : 0;
  return (
    <div className="mt-3 flex gap-1" aria-hidden>
      {Array.from({ length: n }, (_, i) => <i key={i} className="h-1 flex-1" style={{ background: i < on ? color : i < on + bad ? "#ff9f1c" : "rgb(255 255 255 / 0.07)", boxShadow: i < on ? `0 0 6px ${color}` : undefined }} />)}
    </div>
  );
}

function Check({ ok, idle }: { ok: boolean; idle?: boolean }) {
  const c = idle ? "#7f97ab" : ok ? "#3df5a0" : "#ff9f1c";
  return <span aria-hidden className="grid h-6 w-6 shrink-0 place-items-center border text-xs" style={{ color: c, borderColor: `color-mix(in srgb, ${c} 60%, transparent)`, boxShadow: idle ? undefined : `0 0 8px color-mix(in srgb, ${c} 35%, transparent)` }}>{idle ? "–" : ok ? "✓" : "!"}</span>;
}

export default async function SecurityPage() {
  await requireSection("security");
  const me = await requireUser();
  const d = await getDashboard();
  const now = today();
  const s = d.security;
  const advisories = d.databases.flatMap((db) => (db.advisories ?? []).map((a) => ({ ...a, db })));
  const hardening = [
    { ok: me.hasTotp, label: "Two-factor sign-in on your dashboard account" },
    { ok: require2fa(), label: "2FA required for every sign-in", code: "REQUIRE_2FA" },
    { ok: !!env("ENCRYPTION_KEY"), label: "Stored credentials encrypted with your own", code: "ENCRYPTION_KEY" },
    { ok: clientIpVerifiable() || process.env.NODE_ENV !== "production", label: "Client IPs verifiable for per-IP sign-in limits (Vercel or TRUSTED_PROXY)" },
    { ok: !!env("CRON_SECRET"), label: "Scheduled checks enabled", code: "CRON_SECRET" },
  ];

  const accounts = ACCOUNT_CHECKLIST.map((item) => {
    const at = d.records.checklist[item.id];
    const fresh = !!at && daysBetween(at.slice(0, 10), now) < CONFIRMATION_VALID_DAYS;
    const used = (d.modes as Record<string, string>)[item.usedWhen] === "live";
    return { item, at, fresh, used };
  });
  // Accounts that count toward 2FA: the ones you use or have confirmed, plus GitHub when its API tells us.
  const counted = accounts.filter((a) => a.used || a.fresh);
  const twofa = {
    confirmed: counted.filter((a) => a.fresh).length + (s.github2fa === true ? 1 : 0),
    total: counted.length + (s.github2fa != null ? 1 : 0),
  };
  const codeKnown = s.repos.length > 0 || s.alerts.length > 0;
  const databaseKnown = d.databases.some((db) => db.provider === "supabase" && db.status !== "paused");
  const { score, parts } = securityScore({ security: s, codeKnown, twofa, databases: d.databases, databaseKnown });

  const serious = [...s.alerts.map((a) => a.severity), ...advisories.map((a) => a.level)].filter((x) => x === "critical" || x === "high").length;
  const alertRepos = [...new Set(s.alerts.map((a) => a.repo.split("/").pop()))];
  const covered = s.repos.filter((r) => r.dependabot === "on").length;
  const off = s.repos.filter((r) => r.dependabot === "off").length;

  // Findings closed in the last 30 days (from the task history, when the database is up).
  const resolved = d.dbError
    ? null
    : (await getTasksByStatus("done").catch(() => null))
        ?.filter((t) => taskSection(t.sourceKey) === "security" && (!d.business || t.business === d.business))
        .map((t) => ({ t, at: (t as unknown as { resolvedAt?: string | null }).resolvedAt ?? null }))
        .filter((x) => x.at && daysBetween(x.at.slice(0, 10), now) <= 30)
        .sort((a, b) => b.at!.localeCompare(a.at!)) ?? null;

  return (
    <>
      <PageHeader mode={d.modes.security} title="Security" subtitle="Vulnerable dependencies, leaked secrets, database findings and two-factor sign-in across your accounts.">
        <span className="hud-label inline-flex min-h-10 items-center border border-line px-3 font-mono text-[11px] text-muted sm:min-h-0 sm:py-1.5">GitHub · Supabase{d.modes.security === "live" ? "" : " · not connected"}</span>
      </PageHeader>

      <div className="mb-5 grid items-start gap-5 lg:grid-cols-[minmax(0,19rem)_minmax(0,1fr)]">
        <Card accent="teal" title="Posture">
          <ScoreRings score={score} parts={parts} />
          <ul className="mt-4 space-y-1.5 text-xs">
            {parts.map((p) => (
              <li key={p.key} className="flex items-center justify-between gap-3">
                <span className="hud-label flex items-center gap-2 text-[11px] text-[#c5d3de]"><i className="inline-block h-2 w-2" style={{ background: PART_COLOR[p.key], boxShadow: `0 0 6px ${PART_COLOR[p.key]}` }} />{p.label}</span>
                <span className="text-muted">{p.detail} · <b className="font-mono font-medium text-ink tabular-nums">{p.score}</b></span>
              </li>
            ))}
            {parts.length === 0 && <li className="text-muted">Connect GitHub or Supabase to score your setup.</li>}
          </ul>
          <details className="mt-3 text-xs text-muted">
            <summary className="inline-flex min-h-10 cursor-pointer items-center text-accent sm:min-h-0">How the score works</summary>
            <p className="mt-1 leading-relaxed">Each area starts at 100. Code loses {PENALTY.critical} per critical, {PENALTY.high} per high, {PENALTY.medium} per medium and {PENALTY.low} per low open alert, and {DEPENDABOT_OFF_PENALTY} per repo without Dependabot. Two-factor is the share of the accounts you use that are confirmed. Database loses the same per advisor finding. The score is the average of the areas with data.</p>
          </details>
        </Card>

        <Card accent="cyan" flush title="At a glance" action={serious ? `${serious} critical or high` : "no critical or high findings"}>
          <div className="grid grid-cols-2 xl:grid-cols-4">
            {[
              { l: "Critical / high", v: serious, d: "code & database", c: serious ? "#ff3d6e" : "#3df5a0", seg: <Segments filled={serious ? 1 : 1} total={1} color={!serious ? "#3df5a0" : [...s.alerts.map((a) => a.severity), ...advisories.map((a) => a.level)].includes("critical") ? "#ff3d6e" : "#ff9f1c"} /> },
              { l: "Open code alerts", v: s.alerts.length, d: s.alerts.length ? `${s.alerts.every((a) => a.severity === "low") ? "all low · " : ""}${alertRepos.slice(0, 2).join(", ")}${alertRepos.length > 2 ? ` +${alertRepos.length - 2}` : ""}` : "none open", c: "#3fd0ff", seg: <Segments filled={s.alerts.length} total={Math.max(4, s.alerts.length)} color="#3fd0ff" /> },
              { l: "Two-factor", v: twofa.total ? <>{twofa.confirmed}<span className="text-base text-muted"> / {twofa.total}</span></> : "—", d: "accounts confirmed", c: "#a98bff", seg: <Segments filled={twofa.confirmed} total={twofa.total} color="#a98bff" warn={twofa.total - twofa.confirmed} /> },
              { l: "Dependabot", v: s.repos.length ? <>{covered}<span className="text-base text-muted"> / {s.repos.length}</span></> : "—", d: "repos covered", c: "#2ef2d0", seg: <Segments filled={covered} total={s.repos.length} color="#2ef2d0" warn={off} /> },
            ].map((k) => (
              <div key={k.l} className="border-b border-r border-line/60 p-4 sm:p-5 [&:nth-child(2n)]:border-r-0 xl:[&:nth-child(2n)]:border-r xl:last:border-r-0">
                <div className="hud-label text-[11px] text-muted">{k.l}</div>
                <div className="mt-2 font-display text-3xl font-semibold leading-none tabular-nums" style={{ color: k.c, textShadow: `0 0 14px color-mix(in srgb, ${k.c} 45%, transparent)` }}>{k.v}</div>
                <div className="mt-1.5 truncate text-xs text-muted">{k.d}</div>
                {k.seg}
              </div>
            ))}
          </div>
          <div className="px-4 py-4 sm:px-5">
            <div className="hud-label mb-2 text-[11px] text-muted">Resolved · last 30 days {resolved && <span className="ml-1 font-mono text-emerald">{resolved.length}</span>}</div>
            {resolved == null ? <p className="text-xs text-muted">Task history isn&apos;t available right now.</p> : resolved.length === 0 ? <p className="text-xs text-muted">Nothing resolved in the last 30 days.</p> : (
              <ul className="divide-y divide-line/50">
                {resolved.slice(0, 5).map(({ t, at }) => (
                  <li key={t.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 text-[13px]">
                    <Tag color="#3df5a0">{t.title.startsWith("Rotate") ? "Revoked" : "Fixed"}</Tag>
                    <span className="min-w-0 flex-1 basis-48">{t.title}</span>
                    <span className="text-xs text-muted">{t.severity} · {formatDate(at!.slice(0, 10))}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>

      <div className="mb-5 grid items-start gap-5 xl:grid-cols-2">
        <Card accent="cyan" flush title="Code alerts" action={`${s.alerts.length} open`}>
          {s.alerts.length === 0 ? <Empty>No open Dependabot or secret-scanning alerts.</Empty> : (
            <ul className="divide-y divide-line/60">
              {s.alerts.map((a) => (
                <li key={`${a.repo}-${a.kind}-${a.number}`} className="flex items-center gap-4 px-4 py-3 sm:px-5">
                  <span className="w-16 shrink-0"><SeverityBadge severity={a.severity} /></span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] text-ink">{a.title}</div>
                    <div className="text-xs text-muted">{a.repo} · {a.kind === "secret" ? "secret scanning" : "Dependabot"} · {timeAgo(a.createdAt)}</div>
                  </div>
                  <a href={a.url} target="_blank" rel="noreferrer" className={view} style={{ "--b": "#ff5fd7" } as CSSProperties}>View</a>
                </li>
              ))}
            </ul>
          )}
          {s.repos.length > 0 && (
            <details className="border-t border-line/70 px-4 py-3 sm:px-5" open={s.repos.length <= 16}>
              <summary className="hud-label inline-flex min-h-10 cursor-pointer items-center text-[11px] text-cyan sm:min-h-0">Coverage across {s.repos.length} repos</summary>
              <ul className="mt-2 grid gap-x-6 text-xs sm:grid-cols-2">
                {s.repos.map((r) => (
                  <li key={r.repo} className="flex justify-between gap-2 border-b border-dashed border-line/60 py-1.5">
                    <span className="truncate text-[#c5d3de]">{r.repo.split("/").pop()}</span>
                    <span className="shrink-0 text-muted">Dependabot <span className={r.dependabot === "off" ? "text-high" : r.dependabot === "on" ? "text-emerald" : ""}>{r.dependabot}</span> · secrets <span className={r.secretScanning === "on" ? "text-emerald" : ""}>{r.secretScanning === "unavailable" ? "n/a" : r.secretScanning}</span></span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </Card>

        <div className="grid content-start gap-5">
          <Card accent="emerald" flush title="Database findings" action="Supabase advisors">
            {advisories.length === 0 ? <Empty>{databaseKnown ? "No advisor findings." : "No Supabase projects connected."}</Empty> : (
              <ul className="divide-y divide-line/60">
                {advisories.map((a, i) => (
                  <li key={i} className="flex items-center gap-4 px-4 py-3 sm:px-5">
                    <span className="w-16 shrink-0"><SeverityBadge severity={a.level} /></span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[14px] text-ink">{a.title}</div>
                      <div className="text-xs text-muted">{a.db.name}{a.db.business ? ` · ${a.db.business}` : ""}</div>
                    </div>
                    {a.db.provider === "supabase" && <a href={`https://supabase.com/dashboard/project/${a.db.id}/advisors/security`} target="_blank" rel="noreferrer" className={view} style={{ "--b": "#ff5fd7" } as CSSProperties}>View</a>}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card accent="violet" flush title="This dashboard" action={`${hardening.filter((h) => h.ok).length} / ${hardening.length} hardened`}>
            <ul className="divide-y divide-line/60 text-[13.5px]">
              {hardening.map((h) => (
                <li key={h.label} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
                  <Check ok={h.ok} />
                  <span className={h.ok ? "" : "text-high"}>{h.label}{h.code && <code className="ml-2 bg-cyan/10 px-1.5 py-0.5 font-mono text-[11px] text-cyan">{h.code}</code>}{!h.ok && <span className="sr-only"> (not set)</span>}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      <div id="checklist" className="scroll-mt-6">
        <Card accent="pink" flush title="Two-factor sign-in on your accounts" action="confirmations expire after a year">
          <ul className="divide-y divide-line/60 text-[14px]">
            <li className="flex items-center gap-4 px-4 py-3 sm:px-5">
              <Check ok={s.github2fa === true} idle={s.github2fa == null} />
              <div className="min-w-0 flex-1">GitHub{s.githubLogin ? <span className="text-muted"> ({s.githubLogin})</span> : ""}<div className="text-xs text-muted">{s.github2fa === true ? "verified automatically through the API" : s.github2fa === false ? "two-factor sign-in is off" : "can't tell from this token"}</div></div>
              {s.github2fa === true ? <Tag color="#3df5a0">Verified</Tag> : s.github2fa === false ? <a href="https://github.com/settings/security" target="_blank" rel="noreferrer" className={`${view} hud-btn-solid`} style={{ "--b": "#ff3d6e" } as CSSProperties}>Turn it on</a> : null}
            </li>
            {accounts.map(({ item, at, fresh, used }) => (
              <li key={item.id} className="flex items-center gap-4 px-4 py-3 sm:px-5">
                <Check ok={fresh} idle={!fresh && !used} />
                <div className="min-w-0 flex-1">
                  <span className={!fresh && !used ? "text-muted" : ""}>{item.url ? <a href={item.url} target="_blank" rel="noreferrer" className="hover:text-pink">{item.name}</a> : item.name}</span>
                  <div className="text-xs text-muted">{fresh ? `confirmed ${timeAgo(at)}` : at ? "re-check: confirmed over a year ago" : used ? "in use, not confirmed yet" : "not connected"}</div>
                </div>
                <ChecklistToggle id={item.id} confirmed={fresh} />
              </li>
            ))}
          </ul>
          <p className="border-t border-line/70 px-4 py-3 text-xs text-muted sm:px-5">These platforms don&apos;t report 2FA through their APIs, so you confirm each one. Confirmations expire after a year.</p>
        </Card>
      </div>
    </>
  );
}
