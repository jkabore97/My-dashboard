import type { Metadata } from "next";
import { connection } from "next/server";
import { clientPage, type ClientPage } from "@/lib/server/portal";
import { formatDate } from "@/lib/dates";
import { Group, SYS, SectionTitle, SeverityIcon, Tag, timeAgo } from "@/components/ui";
import { overallStatus } from "@/components/sites/portal";

// A client's read-only status page: their sites' uptime and their projects.
// Public by link (the link is the secret); never indexed, never cached.

export const metadata: Metadata = { title: "Status", referrer: "no-referrer", robots: { index: false, follow: false } };

const STATUS = {
  up: { label: "Operational", color: "var(--color-ok)", dot: SYS.green },
  degraded: { label: "Slow or partly down", color: "var(--color-warn)", dot: SYS.orange },
  down: { label: "Down", color: "var(--color-critical)", dot: SYS.red },
  unknown: { label: "Not checked yet", color: "var(--color-muted)", dot: SYS.gray },
} as const;

const STAGE_COLOR: Record<string, string> = { Underway: SYS.indigo, Finalizing: SYS.blue, "Proposal sent": SYS.teal, "In discussion": SYS.gray };

function Shell({ children, page }: { children: React.ReactNode; page?: ClientPage }) {
  const checked = page?.sites.map((s) => s.checkedAt).filter((x): x is string => !!x).sort().at(-1) ?? null;
  return (
    <main className="mx-auto min-h-screen max-w-[880px] px-4 py-8 sm:px-6 sm:py-12">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/kaj-k.png" alt="Kaj Consulting" width={30} height={32} className="h-8 w-auto" />
          <span className="text-[13px] text-muted">Status{page?.business ? ` by ${page.business}` : ""}</span>
        </div>
        {checked && <span className="flex items-center gap-2 text-[13px] font-medium text-ok"><span className="h-2 w-2 rounded-full bg-ok" />Live · checked {timeAgo(checked)}</span>}
      </div>
      {children}
    </main>
  );
}

const hourColor = (h: number | null) => (h === null ? "var(--color-fill-2)" : h >= 0.99 ? SYS.green : h >= 0.5 ? SYS.orange : SYS.red);

export default async function ClientStatusPage({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  const page = await clientPage(token).catch(() => null);
  if (page === "busy") return <Shell><p className="text-[15px] text-muted">This page is getting a lot of visits. Try again in a minute.</p></Shell>;
  if (!page) {
    return (
      <Shell>
        <h1 className="text-[28px] font-bold tracking-[-0.02em] text-ink">Link not available</h1>
        <p className="mt-2 text-[15px] text-muted">This status link isn&apos;t valid any more. Ask your contact for a new one.</p>
      </Shell>
    );
  }
  const overall = overallStatus(page.sites);
  const oc = overall.state === "up" ? "var(--color-ok)" : overall.state === "down" ? "var(--color-critical)" : overall.state === "degraded" ? "var(--color-warn)" : "var(--color-muted)";

  return (
    <Shell page={page}>
      <p className="text-[15px] text-muted">{page.business ? `${page.business} · ` : ""}Client status</p>
      <h1 className="mt-1 text-[30px] font-bold leading-tight tracking-[-0.02em] text-ink sm:text-[40px]">{page.client}</h1>
      <p className="mt-1 text-[15px] text-muted">Live status of your sites and projects.</p>

      {page.sites.length > 0 && (
        <section className="hud-panel mt-8 flex flex-wrap items-center gap-x-5 gap-y-4 p-5 sm:p-6">
          {overall.state === "up" ? (
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-ok text-2xl font-bold text-white" aria-hidden>✓</span>
          ) : overall.state === "unknown" ? (
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-fill text-xl text-muted" aria-hidden>?</span>
          ) : (
            <SeverityIcon severity={overall.state === "down" ? "critical" : "high"} size={48} />
          )}
          <div className="min-w-0 flex-1">
            <div className="text-[20px] font-semibold text-ink">{overall.title}</div>
            <div className="text-[15px] text-muted">{overall.detail}</div>
          </div>
          {overall.uptime30d !== null && (
            <div className="text-right">
              <div className="text-[30px] font-bold leading-tight tabular-nums" style={{ color: oc }}>{overall.uptime30d}%</div>
              <div className="text-[13px] text-muted">Uptime · 30 days</div>
            </div>
          )}
        </section>
      )}

      {page.sites.length > 0 && (
        <section className="mt-10">
          <SectionTitle>Websites</SectionTitle>
          <div className="mb-4 flex flex-wrap gap-x-5 gap-y-1 px-1 text-[13px] text-muted">
            <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-[3px]" style={{ background: SYS.green }} />Up</span>
            <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-[3px]" style={{ background: SYS.orange }} />Slow or partly down</span>
            <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-[3px]" style={{ background: SYS.red }} />Down</span>
            <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-[3px] bg-fill-2" />No checks</span>
            <span>Last 24 hours, hour by hour</span>
          </div>
          <div className="grid gap-4">
            {page.sites.map((s) => {
              const st = STATUS[s.status] ?? STATUS.unknown;
              return (
                <div key={s.domain} className="hud-panel p-5 sm:p-6">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0 break-all text-[17px] font-semibold text-ink">{s.domain}</span>
                    <span className="flex items-center gap-2 text-[13px] font-semibold" style={{ color: st.color }}>
                      {s.status === "down" ? <SeverityIcon severity="critical" size={16} /> : s.status === "degraded" ? <SeverityIcon severity="high" size={16} /> : <span className="h-2 w-2 rounded-full" style={{ background: st.dot }} />}
                      {st.label}
                    </span>
                  </div>
                  <div className="mt-4 flex h-8 gap-[2px] sm:gap-1" role="img" aria-label="Last 24 hours, hour by hour">
                    {s.hours.map((h, i) => (
                      <span key={i} title={h === null ? "no checks" : `${Math.round(h * 100)}% up`} className="flex-1 rounded-[3px]" style={{ background: hourColor(h) }} />
                    ))}
                  </div>
                  <div className="mt-1.5 flex justify-between text-[12px] text-muted"><span>24 hours ago</span><span>now</span></div>
                  <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-line pt-4">
                    <div><dt className="text-[12px] text-muted sm:text-[13px]">Uptime · 7 days</dt><dd className="mt-0.5 text-[17px] font-semibold tabular-nums text-ink">{s.uptime7d === null ? "—" : `${s.uptime7d}%`}</dd></div>
                    <div><dt className="text-[12px] text-muted sm:text-[13px]">Uptime · 30 days</dt><dd className="mt-0.5 text-[17px] font-semibold tabular-nums text-ink">{s.uptime30d === null ? "—" : `${s.uptime30d}%`}</dd></div>
                    <div><dt className="text-[12px] text-muted sm:text-[13px]">Response</dt><dd className="mt-0.5 text-[17px] font-semibold tabular-nums text-ink">{s.responseMs === null ? "—" : `${s.responseMs} ms`}</dd></div>
                  </dl>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {page.projects && (
        <section className="mt-10">
          <SectionTitle>Projects</SectionTitle>
          {page.projects.length === 0 ? (
            <Group><p className="px-4 py-8 text-center text-[15px] text-muted">No active projects.</p></Group>
          ) : (
            <Group>
              {page.projects.map((p, i) => (
                <div key={i} className="flex min-h-11 flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
                  <div className="min-w-0">
                    <div className="text-[15px] text-ink">{p.title}</div>
                    <div className="text-[13px] text-muted">{p.stage}{p.expectedClose ? ` · expected ${formatDate(p.expectedClose)}` : p.closedOn ? ` · since ${formatDate(p.closedOn)}` : ""}</div>
                  </div>
                  <Tag color={STAGE_COLOR[p.stage] ?? SYS.gray}>{p.stage}</Tag>
                </div>
              ))}
            </Group>
          )}
        </section>
      )}

      <p className="mt-10 border-t border-line pt-5 text-[13px] text-muted">Checked every 5 minutes. Times are approximate.</p>
    </Shell>
  );
}
