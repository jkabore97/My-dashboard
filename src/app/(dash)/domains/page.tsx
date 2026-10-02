import { getDashboard } from "@/lib/server/dashboard";
import { getConfig } from "@/lib/server/config";
import { businessForDomain } from "@/lib/server/config";
import { registrableDomain, type DomainCheck } from "@/lib/server/domains";
import { certificateSeverity, registrationSeverity } from "@/lib/risk";
import { daysBetween, formatDate, relativeDays, today } from "@/lib/dates";
import { Card, PageHeader, StatusDot, Table, td, timeAgo } from "@/components/ui";
import { CheckNowButton, DomainSettingsForm } from "@/components/records";
import type { Severity } from "@/lib/types";

const DOT: Record<Severity, "bad" | "warn" | "idle"> = { critical: "bad", high: "bad", medium: "warn", low: "warn" };

function Expiry({ date, severity, now }: { date: string | null; severity: (days: number) => Severity | null; now: string }) {
  if (!date) return <span className="text-muted">unknown</span>;
  const days = daysBetween(now, date);
  const sev = severity(days);
  return (
    <span className="flex items-center gap-2">
      <StatusDot status={sev ? DOT[sev] : "ok"} />
      <span>{formatDate(date)}<span className="block text-xs text-muted">{relativeDays(days)}</span></span>
    </span>
  );
}

function Pill({ ok, warn, children, title }: { ok: boolean; warn?: boolean; children: React.ReactNode; title?: string }) {
  const tone = ok ? (warn ? "bg-high/15 text-high" : "bg-ok/15 text-ok") : "bg-critical/15 text-critical";
  return <span title={title} className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${tone}`}>{children}</span>;
}

function EmailHealth({ c }: { c: DomainCheck["email"] }) {
  if (!c.ok) return <span className="text-xs text-muted" title={c.error}>lookup failed</span>;
  if (!c.mx.length) return <span className="text-xs text-muted">no mail on this domain</span>;
  return (
    <span className="flex flex-wrap gap-1">
      <Pill ok={!!c.spf} title={c.spf ?? "No SPF record"}>SPF {c.spf ? "✓" : "missing"}</Pill>
      <Pill ok={!!c.dmarc} warn={c.dmarcPolicy === "none"} title={c.dmarc ?? "No DMARC record"}>DMARC {c.dmarc ? `p=${c.dmarcPolicy ?? "?"}` : "missing"}</Pill>
      <Pill ok={c.dkim.length > 0} warn={!c.dkim.length} title={c.dkim.length ? `Selectors: ${c.dkim.join(", ")}` : "No DKIM key found for the selectors checked"}>DKIM {c.dkim.length ? "✓" : "not found"}</Pill>
    </span>
  );
}

export default async function DomainsPage() {
  const d = await getDashboard();
  const { sites, extraDomains, dkimSelectors } = await getConfig();
  const now = today();
  const { checks, pending } = d.domains;
  return (
    <>
      <PageHeader mode={d.modes.domains} title="Domains" subtitle="Registration and SSL expiry, plus whether your email is set up so it doesn't land in spam. Checked twice a day.">
        {d.modes.domains === "live" && <CheckNowButton />}
      </PageHeader>
      <Card>
        <Table head={["Domain", "Business", "Registration", "SSL certificate", "Email", "Checked"]}>
          {checks.map((c) => (
            <tr key={c.domain}>
              <td className={td}>
                <a href={`https://${c.domain}`} target="_blank" rel="noreferrer" className="hover:text-accent">{c.domain}</a>
                {registrableDomain(c.domain) !== c.domain && <div className="text-xs text-muted">registered as {registrableDomain(c.domain)}</div>}
              </td>
              <td className={`${td} text-muted`}>{businessForDomain(c.domain, sites) ?? "—"}</td>
              <td className={td}>
                {c.registration.ok ? (
                  <><Expiry date={c.registration.expiresOn} severity={registrationSeverity} now={now} />{c.registration.registrar && <span className="text-xs text-muted">{c.registration.registrar}</span>}</>
                ) : <span className="text-xs text-muted" title={c.registration.error}>lookup failed</span>}
              </td>
              <td className={td}>
                {c.certificate.ok && c.certificate.valid === false ? (
                  <span className="text-xs text-critical">invalid: {c.certificate.problem ?? "not trusted"}<span className="block text-muted">expires {formatDate(c.certificate.expiresOn)}</span></span>
                ) : c.certificate.ok ? (
                  <><Expiry date={c.certificate.expiresOn} severity={certificateSeverity} now={now} />{c.certificate.issuer && <span className="text-xs text-muted">{c.certificate.issuer}</span>}</>
                ) : <span className="text-xs text-critical" title={c.certificate.error}>no valid certificate</span>}
              </td>
              <td className={td}><EmailHealth c={c.email} /></td>
              <td className={`${td} text-xs text-muted`}>{timeAgo(c.checkedAt)}</td>
            </tr>
          ))}
          {pending.map((p) => (
            <tr key={p}>
              <td className={td}>{p}</td>
              <td className={`${td} text-muted`}>{businessForDomain(p, sites) ?? "—"}</td>
              <td className={`${td} text-xs text-muted`} colSpan={4}>Not checked yet. Use Check now, or wait for the next scheduled run.</td>
            </tr>
          ))}
        </Table>
        {checks.length + pending.length === 0 && <p className="py-6 text-center text-sm text-muted">Add websites in Settings or domains below to start watching them.</p>}
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Domains to watch">
          <DomainSettingsForm extra={extraDomains.join("\n")} selectors={dkimSelectors.join(", ")} />
        </Card>
        <Card title="What the checks mean">
          <dl className="space-y-3 text-sm">
            <div><dt className="font-medium">Registration</dt><dd className="text-muted">When the domain itself lapses. Alerts at 30, 14 and 3 days, rising from low to critical. Turn on auto-renew at your registrar.</dd></div>
            <div><dt className="font-medium">SSL certificate</dt><dd className="text-muted">Hosts like Vercel and Cloudflare renew these automatically around 30 days out. A warning inside 20 days means renewal is failing (often a DNS change).</dd></div>
            <div><dt className="font-medium">SPF, DKIM, DMARC</dt><dd className="text-muted">Prove mail from your domain is really you. Without them, invoices and proposals land in spam and others can spoof your address.</dd></div>
          </dl>
        </Card>
      </div>
    </>
  );
}
