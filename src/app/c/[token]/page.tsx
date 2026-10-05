import type { CSSProperties } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { clientPage, type ClientPage } from "@/lib/server/portal";
import { formatDate } from "@/lib/dates";
import { SeverityIcon, Tag, timeAgo } from "@/components/ui";
import { SectionRule } from "@/components/sites/bits";
import { overallStatus } from "@/components/sites/portal";

// A client's read-only status page: their sites' uptime and their projects.
// Public by link (the link is the secret); never indexed, never cached.

export const metadata: Metadata = { title: "Status", referrer: "no-referrer", robots: { index: false, follow: false } };

const STATUS = {
  up: { label: "Operational", color: "#3df5a0" },
  degraded: { label: "Slow or partly down", color: "#ff9f1c" },
  down: { label: "Down", color: "#ff3d6e" },
  unknown: { label: "Not checked yet", color: "#7f97ab" },
} as const;

const STAGE_COLOR: Record<string, string> = { Underway: "#a98bff", Finalizing: "#3fd0ff", "Proposal sent": "#2ef2d0", "In discussion": "#7f97ab" };

function Shell({ children, page }: { children: React.ReactNode; page?: ClientPage }) {
  const checked = page?.sites.map((s) => s.checkedAt).filter((x): x is string => !!x).sort().at(-1) ?? null;
  return (
    <main className="mx-auto min-h-screen max-w-[1080px] px-4 py-8 sm:px-6 sm:py-12">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/kaj-k.png" alt="Kaj Consulting" width={30} height={32} className="h-8 w-auto" />
          <span className="hud-label text-[12px] text-muted">Status{page?.business ? ` by ${page.business}` : ""}</span>
        </div>
        {checked && <span className="hud-label flex items-center gap-2 text-[12px] text-emerald"><span className="h-2 w-2 rounded-full bg-emerald shadow-[0_0_8px_#3df5a0]" />Live · checked {timeAgo(checked)}</span>}
      </div>
      {children}
    </main>
  );
}

export default async function ClientStatusPage({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  const page = await clientPage(token).catch(() => null);
  if (page === "busy") return <Shell><p className="text-sm text-muted">This page is getting a lot of visits. Try again in a minute.</p></Shell>;
  if (!page) {
    return (
      <Shell>
        <h1 className="font-display text-2xl font-semibold">Link not available</h1>
        <p className="mt-2 text-sm text-muted">This status link isn&apos;t valid any more. Ask your contact for a new one.</p>
      </Shell>
    );
  }
  const overall = overallStatus(page.sites);
  const oc = overall.state === "up" ? "#3df5a0" : overall.state === "down" ? "#ff3d6e" : overall.state === "degraded" ? "#ff9f1c" : "#7f97ab";

  return (
    <Shell page={page}>
      <p className="hud-label text-[12px] text-teal">{page.business ? `${page.business} · ` : ""}Client status</p>
      <h1 className="mt-2 bg-gradient-to-r from-teal to-[#eaf7ff] bg-clip-text font-display text-3xl font-semibold tracking-[0.04em] text-transparent sm:text-[40px]">{page.client}</h1>
      <p className="mt-2 text-[15px] text-muted">Live status of your sites and projects.</p>

      {page.sites.length > 0 && (
        <section className="hud-panel mt-8 flex flex-wrap items-center gap-x-5 gap-y-4 p-5 sm:p-6" style={{ "--a": oc } as CSSProperties}>
          {overall.state === "up" ? (
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full border-2 border-emerald text-xl text-emerald shadow-[0_0_14px_#3df5a0]">✓</span>
          ) : overall.state === "unknown" ? (
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full border-2 border-dashed border-muted text-muted">?</span>
          ) : (
            <SeverityIcon severity={overall.state === "down" ? "critical" : "high"} size={48} />
          )}
          <div className="min-w-0 flex-1">
            <div className="text-xl font-medium">{overall.title}</div>
            <div className="text-sm text-muted">{overall.detail}</div>
          </div>
          {overall.uptime30d !== null && (
            <div className="text-right">
              <div className="font-display text-3xl font-semibold tabular-nums" style={{ color: oc, textShadow: `0 0 12px ${oc}66` }}>{overall.uptime30d}%</div>
              <div className="hud-label text-[11px] text-muted">Uptime · 30 days</div>
            </div>
          )}
        </section>
      )}

      {page.sites.length > 0 && (
        <section className="mt-10">
          <SectionRule>Websites</SectionRule>
          <div className="mb-4 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-muted">
            <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 bg-emerald" />Up</span>
            <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 bg-high" />Slow or partly down</span>
            <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 bg-critical" />Down</span>
            <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 bg-line" />No checks</span>
            <span>Last 24 hours, hour by hour</span>
          </div>
          <div className="grid gap-4">
            {page.sites.map((s) => {
              const st = STATUS[s.status] ?? STATUS.unknown;
              return (
                <div key={s.domain} className="hud-panel p-5 sm:p-6" style={{ "--a": s.status === "up" ? "#2ef2d0" : st.color } as CSSProperties}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0 break-all text-[17px]">{s.domain}</span>
                    <span className="hud-label flex items-center gap-2 text-[12px]" style={{ color: st.color }}>
                      {s.status === "down" ? <SeverityIcon severity="critical" size={16} /> : s.status === "degraded" ? <SeverityIcon severity="high" size={16} /> : <span className="h-2 w-2 rounded-full" style={{ background: st.color, boxShadow: `0 0 6px ${st.color}` }} />}
                      {st.label}
                    </span>
                  </div>
                  <div className="mt-4 flex h-8 gap-[2px] sm:gap-1" role="img" aria-label="Last 24 hours, hour by hour">
                    {s.hours.map((h, i) => (
                      <span key={i} title={h === null ? "no checks" : `${Math.round(h * 100)}% up`} className={`flex-1 ${h === null ? "bg-line/70" : h >= 0.99 ? "bg-gradient-to-b from-emerald/80 to-emerald/40" : h >= 0.5 ? "bg-high shadow-[0_0_6px_#ff9f1c]" : "bg-critical shadow-[0_0_6px_#ff3d6e]"}`} />
                    ))}
                  </div>
                  <div className="mt-1.5 flex justify-between text-xs text-muted"><span>24 hours ago</span><span>now</span></div>
                  <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-line/70 pt-4">
                    <div><dt className="hud-label text-[10.5px] text-muted sm:text-[11px]">Uptime · 7 days</dt><dd className="mt-1 font-mono text-[15px] tabular-nums sm:text-[17px]">{s.uptime7d === null ? "—" : `${s.uptime7d}%`}</dd></div>
                    <div><dt className="hud-label text-[10.5px] text-muted sm:text-[11px]">Uptime · 30 days</dt><dd className="mt-1 font-mono text-[15px] tabular-nums sm:text-[17px]">{s.uptime30d === null ? "—" : `${s.uptime30d}%`}</dd></div>
                    <div><dt className="hud-label text-[10.5px] text-muted sm:text-[11px]">Response</dt><dd className="mt-1 font-mono text-[15px] tabular-nums sm:text-[17px]">{s.responseMs === null ? "—" : `${s.responseMs} ms`}</dd></div>
                  </dl>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {page.projects && (
        <section className="mt-10">
          <SectionRule>Projects</SectionRule>
          {page.projects.length === 0 ? (
            <p className="text-sm text-muted">No active projects.</p>
          ) : (
            <ul className="hud-panel" style={{ "--a": "#a98bff" } as CSSProperties}>
              {page.projects.map((p, i) => (
                <li key={i} className="flex flex-wrap items-center justify-between gap-3 border-b border-line/50 px-5 py-4 last:border-0 sm:px-6">
                  <div className="min-w-0">
                    <div className="text-[16px]">{p.title}</div>
                    <div className="text-[13px] text-muted">{p.stage}{p.expectedClose ? ` · expected ${formatDate(p.expectedClose)}` : p.closedOn ? ` · since ${formatDate(p.closedOn)}` : ""}</div>
                  </div>
                  <Tag color={STAGE_COLOR[p.stage] ?? "#7f97ab"}>{p.stage}</Tag>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <p className="mt-10 border-t border-line/60 pt-5 text-[13px] text-muted">Checked every 5 minutes. Times are approximate.</p>
    </Shell>
  );
}
