import Link from "next/link";
import { requireSection } from "@/lib/server/auth";
import { emailEnabled } from "@/lib/server/notify";
import { briefHour, knownBusinesses, weeklyReport } from "@/lib/server/reports";
import { addDays, formatDate, isDate, today } from "@/lib/dates";
import { formatTotals } from "@/lib/money";
import { inBusiness, isFullOwner } from "@/lib/access";
import { Card, Empty, PageHeader, Stat } from "@/components/ui";
import { ReportButtons } from "@/components/ReportButtons";

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ business?: string; to?: string }> }) {
  const user = await requireSection("reports");
  const sp = await searchParams;
  const businesses = (await knownBusinesses()).filter((b) => inBusiness(user, b));
  const business = sp.business && businesses.includes(sp.business) ? sp.business : businesses[0];
  const latest = addDays(today(), -1);
  const to = sp.to && isDate(sp.to) && sp.to <= latest ? sp.to : latest;
  const r = business ? await weeklyReport(business, to) : null;
  const href = (b: string, t = to) => `/reports?business=${encodeURIComponent(b)}&to=${t}`;
  const change = r && r.revenue.length === 1 && r.revenuePrev.length === 1 && r.revenue[0].currency === r.revenuePrev[0].currency && r.revenuePrev[0].amount > 0 ? Math.round(((r.revenue[0].amount - r.revenuePrev[0].amount) / r.revenuePrev[0].amount) * 100) : null;

  return (
    <>
      <PageHeader title="Weekly report" subtitle={`One page per business: revenue, users, uptime, issues closed and deals won. ${emailEnabled() ? `Emailed every Monday at ${briefHour()}:00, with the morning brief daily.` : "Set RESEND_API_KEY, BRIEF_EMAIL_FROM and BRIEF_EMAIL_TO to get it by email."}`} />
      {!business || !r ? (
        <Empty>Add your businesses (Settings → Business rules or Websites) to build reports.</Empty>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
            {businesses.map((b) => (
              <Link key={b} href={href(b)} className={`rounded-full border px-3 py-1 text-sm ${b === business ? "border-accent bg-accent/10 text-ink" : "border-line text-muted hover:text-ink"}`}>{b}</Link>
            ))}
            <span className="mx-2 text-line">|</span>
            <Link href={href(business, addDays(to, -7))} className="text-sm text-muted hover:text-ink">← Previous week</Link>
            {to < latest && <Link href={href(business, addDays(to, 7) > latest ? latest : addDays(to, 7))} className="text-sm text-muted hover:text-ink">Next week →</Link>}
          </div>
          <Card>
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold">{r.business}</h2>
                <p className="text-sm text-muted">{formatDate(r.from)} – {formatDate(r.to)}</p>
              </div>
              <ReportButtons business={r.business} to={r.to} email={emailEnabled()} brief={isFullOwner(user)} />
            </div>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <Stat label="Revenue" value={r.revenue.length ? formatTotals(r.revenue) : "—"} hint={change !== null ? `${change > 0 ? "+" : ""}${change}% vs previous week` : r.revenuePrev.length ? `Previous: ${formatTotals(r.revenuePrev)}` : undefined} />
              <Stat label="New users" value={r.newUsers ?? "—"} />
              <Stat label="Issues closed" value={r.tasksClosed} hint="last 7 days" />
              <Stat label="Still open" value={`${r.openCritical} / ${r.openHigh}`} hint="critical / high" tone={r.openCritical ? "critical" : "ink"} />
            </div>
            <div className="mt-6 grid gap-6 md:grid-cols-2">
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Uptime</h3>
                {r.sites.length ? (
                  <ul className="space-y-1 text-sm">{r.sites.map((s) => <li key={s.domain} className="flex justify-between"><span>{s.domain}</span><span className={`tabular-nums ${s.uptimePct !== null && s.uptimePct < 99 ? "text-high" : ""}`}>{s.uptimePct === null ? "no checks" : `${s.uptimePct}%`}</span></li>)}</ul>
                ) : <p className="text-sm text-muted">No sites for this business.</p>}
              </div>
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Deals won</h3>
                {r.dealsWon.length ? (
                  <ul className="space-y-1 text-sm">{r.dealsWon.map((d, i) => <li key={i} className="flex justify-between gap-2"><span>{d.title}{d.client ? ` · ${d.client}` : ""}</span><span className="tabular-nums">{d.value ? formatTotals([d.value]) : ""}</span></li>)}</ul>
                ) : <p className="text-sm text-muted">None this week.</p>}
                {r.solarKWh !== null && <p className="mt-4 text-sm">Solar produced <strong>{r.solarKWh} kWh</strong></p>}
              </div>
            </div>
          </Card>
        </>
      )}
    </>
  );
}
