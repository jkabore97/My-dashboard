import type { ReactNode } from "react";
import { requireSection } from "@/lib/server/auth";
import { getDashboard } from "@/lib/server/dashboard";
import { getConfig } from "@/lib/server/config";
import { isFullOwner } from "@/lib/access";
import { businessForDomain } from "@/lib/server/config";
import { CHAIN_PROBLEM, registrableDomain, type DomainCheck } from "@/lib/server/domains";
import { certificateSeverity, registrationSeverity } from "@/lib/risk";
import { addDays, daysBetween, formatDate, relativeDays, today } from "@/lib/dates";
import { BizLabel, Card, Empty, PageHeader, StatStrip, SYS, Tag, timeAgo, tint } from "@/components/ui";
import { CheckNowButton, DomainSettingsForm } from "@/components/records";
import { cell, HudTable, Note, Ring, StatusWord, type StatusKind } from "@/components/web/hud";
import { expiryRows } from "@/components/web/logic";
import type { Severity } from "@/lib/types";

const KIND: Record<Severity, StatusKind> = { critical: "bad", high: "warn", medium: "warn", low: "warn" };
const SEV_COLOR: Record<Severity, string> = { critical: SYS.red, high: SYS.orange, medium: SYS.orange, low: SYS.orange };
const SEV_TEXT: Record<Severity, string> = { critical: "var(--color-critical)", high: "var(--color-warn)", medium: "var(--color-warn)", low: "var(--color-warn)" };
const WORD: Record<Severity, string> = { critical: "Critical", high: "High", medium: "Warning", low: "Notice" };

function Expiry({ date, severity, now, sub, note }: { date: string | null; severity: (days: number) => Severity | null; now: string; sub?: string | null; note?: string }) {
  if (!date) return <span className="text-[13px] text-muted">unknown</span>;
  const days = daysBetween(now, date);
  const sev = severity(days);
  return (
    <div className="flex items-start gap-2">
      <span className="mt-1.5"><StatusWord kind={sev ? KIND[sev] : "ok"}>{""}</StatusWord></span>
      <div className="min-w-0 text-[13px]">
        <b className="font-medium text-ink">{formatDate(date)}</b>
        <span className={`block text-[13px] ${sev ? "text-warn" : "text-muted"}`}>{relativeDays(days)}{sev && note ? ` · ${note}` : ""}</span>
        {sub && <span className="hidden text-[13px] text-muted sm:block">{sub}</span>}
      </div>
    </div>
  );
}

function Pill({ ok, warn, children, title }: { ok: boolean; warn?: boolean; children: ReactNode; title?: string }) {
  const [c, text] = !ok ? [SYS.red, "var(--color-critical)"] : warn ? [SYS.orange, "var(--color-warn)"] : [SYS.green, "var(--color-ok)"];
  return <span title={title} className="inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[12px] font-semibold" style={{ color: text, background: tint(c, 14) }}>{children}</span>;
}

function EmailHealth({ c }: { c: DomainCheck["email"] }) {
  if (!c.ok) return <span className="text-[13px] text-muted" title={c.error}>lookup failed</span>;
  if (!c.mx.length) return <span className="text-[13px] text-muted">no mail on this domain</span>;
  return (
    <span className="flex flex-wrap gap-1">
      <Pill ok={!!c.spf} title={c.spf ?? "No SPF record"}>SPF {c.spf ? "✓" : "missing"}</Pill>
      <Pill ok={!!c.dmarc} warn={c.dmarcPolicy === "none"} title={c.dmarc ?? "No DMARC record"}>DMARC {c.dmarc ? `p=${c.dmarcPolicy ?? "?"}` : "missing"}</Pill>
      <Pill ok warn={!c.dkim.length} title={c.dkim.length ? `Selectors: ${c.dkim.join(", ")}` : "No DKIM key found for the selectors checked"}>DKIM {c.dkim.length ? "✓" : "not found"}</Pill>
    </span>
  );
}

const CERT_STEPS = ["Check the DNS (A / CNAME) records still point at your host", "Re-verify the domain in your host's project settings", "Click Check now to confirm the new certificate"];
const REG_STEPS = ["Renew the domain at your registrar", "Turn on auto-renew so it can't lapse again", "Click Check now to confirm the new expiry date"];

export default async function DomainsPage() {
  const user = await requireSection("domains");
  const d = await getDashboard();
  const { sites, extraDomains, dkimSelectors } = await getConfig();
  const now = today();
  const { checks, pending } = d.domains;
  const lastRun = checks.reduce<string | null>((a, c) => (!a || c.checkedAt > a ? c.checkedAt : a), null);

  // The most urgent expiry (certificate or registration) inside its alert window.
  const soon = checks
    .flatMap((c) => [
      c.certificate.ok && c.certificate.valid !== false && c.certificate.expiresOn ? { domain: c.domain, kind: "SSL certificate" as const, date: c.certificate.expiresOn, days: daysBetween(now, c.certificate.expiresOn), sev: certificateSeverity(daysBetween(now, c.certificate.expiresOn)), window: 30 } : null,
      c.registration.ok && c.registration.expiresOn ? { domain: registrableDomain(c.domain), kind: "Registration" as const, date: c.registration.expiresOn, days: daysBetween(now, c.registration.expiresOn), sev: registrationSeverity(daysBetween(now, c.registration.expiresOn)), window: 30 } : null,
    ])
    .filter((x): x is NonNullable<typeof x> => !!x?.sev)
    .sort((a, b) => a.days - b.days);
  const top = soon[0];
  const nextExpiry = checks.flatMap((c) => (c.certificate.ok && c.certificate.expiresOn ? [daysBetween(now, c.certificate.expiresOn)] : [])).sort((a, b) => a - b)[0];

  const rows = expiryRows(checks, now);
  const months = [0, 3, 6, 9, 12].map((m) => new Date(`${addDays(now, Math.round(m * 30.42))}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", ...(m === 12 ? { year: "numeric" } : {}) }));
  const regAlerts = rows.filter((r) => r.reg?.severity).length;
  const sslAlerts = checks.filter((c) => (c.certificate.ok && c.certificate.valid === false) || !c.certificate.ok || rows.find((r) => r.domain === c.domain)?.ssl?.severity).length;
  const mail = checks.flatMap((c) => (c.email.ok && c.email.mx.length ? [c.email] : []));
  const signed = mail.filter((e) => e.spf && e.dmarc && e.dkim.length).length;
  const vercelSites = sites.filter((s) => s.domain.endsWith(".vercel.app")).length;

  return (
    <>
      <PageHeader mode={d.modes.domains} title="Domains" subtitle="Registration and SSL expiry, plus whether your email is set up so it doesn't land in spam. Checked twice a day.">
        {lastRun && <span className="text-[13px] text-muted">Last run {timeAgo(lastRun)}</span>}
        {d.modes.domains === "live" && <CheckNowButton />}
      </PageHeader>

      {checks.length > 0 && (
        <div className="mb-5">
          <StatStrip
            items={[
              { label: "Domains checked", value: checks.length, hint: pending.length ? `${pending.length} pending` : "all checked" },
              { label: "Registration alerts", value: regAlerts, tone: regAlerts ? "high" : "ink", hint: regAlerts ? "renew soon" : "none due", hintTone: regAlerts ? "high" : "ok" },
              { label: "SSL alerts", value: sslAlerts, tone: sslAlerts ? "high" : "ink", hint: sslAlerts ? "needs a look" : "all valid", hintTone: sslAlerts ? "high" : "ok" },
              { label: "Mail domains signed", value: mail.length ? `${signed}/${mail.length}` : "—", tone: signed < mail.length ? "high" : "ink", hint: mail.length ? (signed < mail.length ? "SPF, DKIM or DMARC missing" : "SPF, DKIM and DMARC") : "no mail domains", hintTone: signed < mail.length ? "high" : mail.length ? "ok" : undefined },
            ]}
          />
        </div>
      )}

      {checks.length > 0 && (
        <div className="mb-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          {top ? (
            <Card title="Expiring soon" action={`${soon.length} alert${soon.length === 1 ? "" : "s"}`}>
              <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-start">
                <Ring frac={Math.max(0.03, top.days / top.window)} color={SEV_COLOR[top.sev!]} label={`${top.days} days left`}>
                  <span className="text-[40px] font-bold leading-none tabular-nums tracking-[-0.02em] text-ink">{Math.max(0, top.days)}</span>
                  <span className="mt-1 text-[13px] font-semibold" style={{ color: SEV_TEXT[top.sev!] }}>{top.days < 0 ? "Days over" : "Days left"}</span>
                </Ring>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold" style={{ color: SEV_TEXT[top.sev!] }}>{WORD[top.sev!]}{businessForDomain(top.domain, sites) ? ` · ${businessForDomain(top.domain, sites)}` : ""} · {top.kind}</div>
                  <div className="mt-1 text-[17px] font-semibold text-ink">{top.domain} {top.days < 0 ? "expired" : "expires"} {new Date(`${top.date.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" })}</div>
                  <p className="mt-0.5 text-[13px] text-muted">{top.kind === "SSL certificate" ? "Hosts normally renew ~30 days out. Inside 20 days means renewal is failing, often after a DNS change." : "When the registration lapses, the site and its email stop working."}</p>
                  <ol className="mt-3 space-y-2 text-[13px]">
                    {(top.kind === "SSL certificate" ? CERT_STEPS : REG_STEPS).map((step, i) => (
                      <li key={step} className="flex items-start gap-3"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-cyan text-[12px] font-semibold text-white">{i + 1}</span><span className="pt-0.5">{step}</span></li>
                    ))}
                  </ol>
                  {soon.length > 1 && <p className="mt-3 text-[13px] text-muted">Also: {soon.slice(1, 4).map((s) => `${s.domain} ${s.kind.toLowerCase()} ${relativeDays(s.days)}`).join(" · ")}</p>}
                </div>
              </div>
            </Card>
          ) : (
            <Card title="Expiring soon" action="nothing due">
              <div className="flex flex-col items-center gap-5 sm:flex-row">
                <Ring frac={1} color={SYS.green} label="No expiry inside its alert window">
                  <span className="text-[34px] font-bold leading-none tabular-nums tracking-[-0.02em] text-ink">{nextExpiry ?? "—"}</span>
                  <span className="mt-1 px-4 text-[12px] font-semibold leading-tight text-ok">{nextExpiry != null ? "days to next SSL" : "no data"}</span>
                </Ring>
                <div>
                  <div className="text-[17px] font-semibold text-ink">Every certificate and registration is outside its alert window</div>
                  <p className="mt-1 text-[13px] text-muted">Certificates alert inside 20 days, registrations inside 30. The checks run twice a day.</p>
                </div>
              </div>
            </Card>
          )}

          <Card flush title="Expiry timeline · next 12 months" action={`today → ${months[4]}`}>
            <div className="px-4 pt-4 sm:px-5">
              <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
                <span />
                <div className="flex justify-between border-b border-line pb-1.5 text-[11px] text-muted">{months.map((m, i) => <span key={i}>{m}</span>)}</div>
              </div>
              <ul className="mt-2 space-y-2.5">
                {rows.map((r) => (
                  <li key={r.domain} className="grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-3 text-[14px] sm:grid-cols-[10rem_minmax(0,1fr)]">
                    <span className="truncate text-ink" title={r.domain}>{r.domain}</span>
                    <div className="relative h-[22px] overflow-hidden rounded-md bg-panel-2" role="img" aria-label={`${r.domain}: certificate ${r.ssl ? relativeDays(r.ssl.days) : "unknown"}, registration ${r.reg ? relativeDays(r.reg.days) : "unknown"}`}>
                      {r.ssl && <span className="absolute left-0 top-[3px] h-[9px] rounded-full" title={`SSL ${relativeDays(r.ssl.days)}`} style={{ width: `${Math.max(1.5, r.ssl.frac * 100)}%`, background: r.ssl.severity ? SYS.orange : SYS.teal }} />}
                      {r.reg && <span className="absolute left-0 top-[14px] h-[5px] rounded-full" title={`Registration ${relativeDays(r.reg.days)}`} style={{ width: `${Math.max(1.5, r.reg.frac * 100)}%`, background: r.reg.severity ? SYS.orange : SYS.indigo }} />}
                      {!r.ssl && !r.reg && <span className="absolute inset-0 grid place-items-center text-[13px] text-muted">lookups failed</span>}
                    </div>
                  </li>
                ))}
                {pending.map((p) => (
                  <li key={p} className="grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-3 text-[14px] sm:grid-cols-[10rem_minmax(0,1fr)]">
                    <span className="truncate text-muted">{p}</span>
                    <div className="grid h-[22px] place-items-center rounded-md bg-fill text-[12px] text-muted" title="Not checked yet">not checked yet</div>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 pb-4 text-[13px] text-ink">
                <span className="flex items-center gap-1.5"><i className="inline-block h-2 w-2 rounded-full bg-teal" />SSL certificate</span>
                <span className="flex items-center gap-1.5"><i className="inline-block h-2 w-2 rounded-full bg-violet" />Registration</span>
                <span className="flex items-center gap-1.5"><i className="inline-block h-2 w-2 rounded-full bg-high" />Inside alert window</span>
                <span className="w-full text-muted">Bars run from today to the expiry date; past 12 months they fill the row.</span>
              </div>
            </div>
          </Card>
        </div>
      )}

      <Card flush className="mb-5" title="Watched domains" action={`${checks.length} checked${pending.length ? ` · ${pending.length} pending` : ""}`}>
        {checks.length + pending.length === 0 ? <Empty>Add websites in Settings or domains below to start watching them.</Empty> : (
          <HudTable head={[{ label: "Domain" }, { label: "Business", wide: true }, { label: "Registration" }, { label: "SSL certificate" }, { label: "Email", wide: true }, { label: "Checked", wide: true }]}>
            {checks.map((c) => {
              const biz = businessForDomain(c.domain, sites);
              return (
                <tr key={c.domain}>
                  <td className={cell()}>
                    <a href={`https://${c.domain}`} target="_blank" rel="noreferrer" className="[overflow-wrap:anywhere] text-[15px] font-medium text-ink hover:text-cyan">{c.domain}</a>
                    {registrableDomain(c.domain) !== c.domain && <div className="text-[13px] text-muted">registered as {registrableDomain(c.domain)}</div>}
                    <div className="mt-0.5 md:hidden"><BizLabel name={biz} /></div>
                  </td>
                  <td className={`${cell({ wide: true })} whitespace-nowrap`}>{biz ? <BizLabel name={biz} /> : <span className="text-muted">—</span>}</td>
                  <td className={cell()}>
                    {c.registration.ok ? <Expiry date={c.registration.expiresOn} severity={registrationSeverity} now={now} sub={c.registration.registrar} /> : <span className="text-[13px] text-muted" title={c.registration.error}>lookup failed</span>}
                  </td>
                  <td className={cell()}>
                    {c.certificate.ok && c.certificate.valid === false ? (
                      <span className={`text-[13px] ${c.certificate.problem === CHAIN_PROBLEM ? "text-warn" : "text-critical"}`}>{c.certificate.problem === CHAIN_PROBLEM ? "incomplete chain: some apps reject it" : `invalid: ${c.certificate.problem ?? "not trusted"}`}<span className="block text-muted">expires {formatDate(c.certificate.expiresOn)}</span></span>
                    ) : c.certificate.ok ? (
                      <Expiry date={c.certificate.expiresOn} severity={certificateSeverity} now={now} sub={c.certificate.issuer} note="renewal failing" />
                    ) : <span className="text-[13px] text-critical" title={c.certificate.error}>no valid certificate</span>}
                  </td>
                  <td className={cell({ wide: true })}><EmailHealth c={c.email} /></td>
                  <td className={`${cell({ wide: true })} whitespace-nowrap text-[13px] text-muted`}>{timeAgo(c.checkedAt)}</td>
                </tr>
              );
            })}
            {pending.map((p) => (
              <tr key={p}>
                <td className={cell()}>{p}<div className="mt-0.5 md:hidden"><BizLabel name={businessForDomain(p, sites)} /></div></td>
                <td className={`${cell({ wide: true })} whitespace-nowrap`}>{businessForDomain(p, sites) ? <BizLabel name={businessForDomain(p, sites)} /> : <span className="text-muted">—</span>}</td>
                <td className={`${cell()} text-[13px] text-muted`} colSpan={4}><span className="mr-2 align-middle"><Tag color={SYS.blue}>Pending</Tag></span>Not checked yet. Use Check now, or wait for the next scheduled run.</td>
              </tr>
            ))}
          </HudTable>
        )}
        {vercelSites > 0 && <Note>The {vercelSites} shared-host <b className="font-medium text-ink">*.vercel.app</b> site{vercelSites === 1 ? " is" : "s are"} left out: Vercel owns those domains and certificates, so they get uptime checks only.</Note>}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        {isFullOwner(user) && (
          <Card title="Domains to watch" action="owner only">
            <DomainSettingsForm extra={extraDomains.join("\n")} selectors={dkimSelectors.join(", ")} />
          </Card>
        )}
        <Card title="What the checks mean" action="alert rules">
          <dl className="space-y-3 text-[14px]">
            {[
              ["Registration", "When the domain itself lapses. Alerts at 30, 14 and 3 days, rising from low to critical. Turn on auto-renew at your registrar."],
              ["SSL certificate", "Hosts like Vercel and Cloudflare renew these automatically around 30 days out. A warning inside 20 days means renewal is failing (often a DNS change). An expired, self-signed, revoked or wrong-host certificate is critical; an incomplete chain (missing intermediate) is high, since most desktop browsers cope but some apps and phones don't."],
              ["SPF · DKIM · DMARC", "Prove mail from your domain is really you. Without them, invoices and proposals land in spam and others can spoof your address."],
            ].map(([t, dd]) => (
              <div key={t} className="border-b border-line pb-3 last:border-0 last:pb-0"><dt className="text-[15px] font-semibold text-ink">{t}</dt><dd className="mt-1 leading-relaxed text-muted">{dd}</dd></div>
            ))}
          </dl>
        </Card>
      </div>
    </>
  );
}
