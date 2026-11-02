import { businessTimeZone } from "@/lib/dates";
import type { ReactNode } from "react";
import { requireSection } from "@/lib/server/auth";
import { getDashboard } from "@/lib/server/dashboard";
import { BizLabel, Card, Empty, IconTile, PageHeader, SYS, Tag, timeAgo } from "@/components/ui";
import { Attention, cell, FilterChips, HudTable, StatusWord, tasksAsAttention, type StatusKind } from "@/components/web/hud";
import { averageBuildMs, deployMarks, hasDeployHistory } from "@/components/web/logic";
import type { DeployState, HostingProject } from "@/lib/types";

const KIND: Record<DeployState, StatusKind> = { ready: "ok", building: "info", queued: "info", error: "bad", canceled: "idle" };
const MARK: Record<string, string> = { vercel: "var(--color-ink)", cloudflare: SYS.indigo };
const FRAMEWORK: Record<string, string> = { nextjs: "Next.js", vite: "Vite", astro: "Astro", remix: "Remix", sveltekit: "SvelteKit", nuxtjs: "Nuxt", gatsby: "Gatsby", workers: "Worker" };

function ProviderTag({ p }: { p: HostingProject["provider"] }) {
  return <Tag color={p === "cloudflare" ? SYS.cyan : SYS.gray}>{p === "vercel" ? "▲ Vercel" : p === "cloudflare" ? "Cloudflare" : p}</Tag>;
}

function Kpi({ v, l, ok }: { v: ReactNode; l: string; ok?: boolean }) {
  return (
    <div className="min-w-0">
      <b className="hud-num block text-[24px] leading-tight sm:text-[26px]" style={ok ? { color: "var(--color-ok)" } : undefined}>{v}</b>
      <span className="text-[13px] text-muted">{l}</span>
    </div>
  );
}

export default async function HostingPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  await requireSection("hosting");
  const s = await getDashboard();
  const { show } = await searchParams;
  const now = Date.now();

  const vercel = s.hosting.filter((h) => h.provider === "vercel");
  const workers = s.hosting.filter((h) => h.provider === "cloudflare");
  const key = show === "vercel" || show === "workers" ? show : "all";
  const list = key === "vercel" ? vercel : key === "workers" ? workers : s.hosting;

  const marks = deployMarks(s.hosting, now);
  const history = hasDeployHistory(vercel);
  const failed = marks.filter((m) => m.state === "error").length;
  const avg = averageBuildMs(vercel);
  const vercelDeploys = vercel.reduce((n, h) => n + (h.recentDeploys?.length ?? 0), 0);
  const updatedWeek = workers.filter((w) => w.lastDeployAt && now - Date.parse(w.lastDeployAt) < 7 * 86_400_000).length;
  const fixes = tasksAsAttention(s.openTasks, "hosting");
  const hours = [24, 18, 12, 6, 0].map((h) => (h === 0 ? "now" : new Date(now - h * 3_600_000).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: businessTimeZone() })));

  return (
    <>
      <PageHeader mode={s.modes.vercel === "live" || s.modes.workers === "live" ? "live" : s.modes.vercel} title="Hosting" subtitle="Vercel projects and Cloudflare Workers with their latest production deploy.">
        {vercel.length > 0 && workers.length > 0 && <FilterChips base="/hosting" active={key} items={[{ key: "all", label: "All", count: s.hosting.length }, { key: "vercel", label: "Vercel", count: vercel.length }, { key: "workers", label: "Workers", count: workers.length }]} />}
      </PageHeader>

      <div className="mb-5 grid gap-5 lg:grid-cols-2">
        <div className="min-w-0">
          <Card title="Vercel" action={s.modes.vercel === "live" ? "connected" : s.modes.vercel === "error" ? "connection failing" : "not connected"}>
            <div className="flex items-center gap-5">
              <span className="hidden sm:block"><IconTile color="#000000" size={52}><span className="text-[24px] leading-none">▲</span></IconTile></span>
              <div className="grid flex-1 grid-cols-2 gap-4 sm:grid-cols-4">
                <Kpi v={vercel.length} l="projects" />
                <Kpi v={vercel.filter((h) => h.lastDeployState === "ready").length} l="ready" ok={vercel.length > 0 && vercel.every((h) => h.lastDeployState === "ready")} />
                <Kpi v={history ? vercelDeploys : "—"} l="deploys · 24 hours" />
                <Kpi v={avg != null ? `${Math.round(avg / 1000)} s` : "—"} l="avg build" />
              </div>
            </div>
          </Card>
        </div>
        <Card title="Cloudflare Workers" action={s.modes.workers === "live" ? "connected" : s.modes.workers === "error" ? "connection failing" : "not connected"}>
          <div className="flex items-center gap-5">
            <span className="hidden sm:block"><IconTile color={SYS.cyan} size={52}>
              <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="2"><path d="M7 18h11a4 4 0 00.5-8 6 6 0 00-11.6 1.5A3.3 3.3 0 007 18z" /></svg>
            </IconTile></span>
            <div className="grid flex-1 grid-cols-2 gap-4 sm:grid-cols-3">
              <Kpi v={workers.length} l="workers" />
              <Kpi v={workers.filter((w) => w.lastDeployState === "ready").length} l="deployed" ok={workers.length > 0 && workers.every((w) => w.lastDeployState === "ready")} />
              <Kpi v={updatedWeek} l="updated · 7 days" />
            </div>
          </div>
        </Card>
      </div>

      <div className="mb-5 grid items-start gap-5 xl:grid-cols-2">
        <Card title="Production deploys · last 24 hours" action={`${marks.length} deploy${marks.length === 1 ? "" : "s"} · ${failed} failed`}>
          {marks.length === 0 ? (
            <Empty>{history || workers.length ? "No production deploys in the last 24 hours." : "Deploy history appears once Vercel is connected."}</Empty>
          ) : (
            <>
              <div className="relative mx-1 h-20 border-b border-line" role="img" aria-label={`${marks.length} production deploys in the last 24 hours, ${failed} failed`}>
                {marks.map((m, i) => {
                  const c = m.state === "error" ? SYS.red : m.state === "building" || m.state === "queued" ? SYS.blue : MARK[m.provider] ?? "var(--color-ink)";
                  return (
                    <span key={`${m.project}-${m.at}-${i}`} title={`${m.project} · ${m.state ?? "unknown"} · ${timeAgo(m.at)}`} className="absolute bottom-0 w-[2px] -translate-x-1/2 rounded-full" style={{ left: `${m.frac * 100}%`, height: `${40 + ((i * 37) % 5) * 9}%`, background: `color-mix(in srgb, ${c} 45%, transparent)` }}>
                      <span className={`absolute -left-[4px] -top-[5px] block h-2.5 w-2.5 ${m.state === "error" ? "rotate-45" : "rounded-full"}`} style={{ background: c }} />
                    </span>
                  );
                })}
              </div>
              <div className="mt-1.5 flex justify-between text-[11px] tabular-nums text-muted">{hours.map((h) => <span key={h}>{h}</span>)}</div>
              <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-ink">
                <li className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-ink" />Vercel ready</li>
                <li className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-violet" />Worker deployed</li>
                <li className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-cyan" />Building</li>
                {failed > 0 && <li className="flex items-center gap-1.5"><i className="h-2 w-2 rotate-45 bg-critical" />Failed</li>}
              </ul>
              {!history && vercel.length > 0 && <p className="mt-2 text-[13px] text-muted">Vercel&apos;s deploy history couldn&apos;t be read this time; only Workers are shown.</p>}
            </>
          )}
        </Card>

        {fixes.length ? (
          <Attention title="One-click fixes" items={fixes} foot="Redeploy rebuilds the same commit and config with your connected account, after you confirm." />
        ) : (
          <Card title="One-click fixes" action="nothing to fix">
            <div className="flex items-start gap-4">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ok text-[17px] font-bold text-white" aria-hidden>✓</span>
              <div>
                <div className="text-[15px] font-semibold text-ink">Every production deploy is healthy</div>
                <p className="mt-0.5 text-[13px] text-muted">When a Vercel production deploy fails, a <b className="font-medium text-ink">Redeploy</b> button shows here and on the alert. It rebuilds the same commit and config with your connected account, after you confirm.</p>
              </div>
            </div>
          </Card>
        )}
      </div>

      <Card flush title="Projects" action="latest production deploy">
        {list.length === 0 ? <Empty>Connect Vercel or Cloudflare on the Platforms page to list your projects.</Empty> : (
          <HudTable head={[{ label: "Project" }, { label: "Provider", wide: true }, { label: "Business", wide: true }, { label: "Last deploy" }, { label: "When", wide: true }, { label: "URL", wide: true }]}>
            {list.map((h) => (
              <tr key={h.id}>
                <td className={cell()}>
                  <span className="text-[15px] font-medium text-ink">{h.name}</span>
                  <span className="block text-[13px] text-muted">{h.framework ? FRAMEWORK[h.framework] ?? h.framework : h.provider === "cloudflare" ? "Worker" : ""}<span className="md:hidden">{h.business ? ` · ${h.business}` : ""}</span></span>
                </td>
                <td className={`${cell({ wide: true })} whitespace-nowrap`}><ProviderTag p={h.provider} /></td>
                <td className={`${cell({ wide: true })} whitespace-nowrap`}>{h.business ? <BizLabel name={h.business} /> : <span className="text-muted">—</span>}</td>
                <td className={cell()}>
                  {h.lastDeployState ? <StatusWord kind={KIND[h.lastDeployState]}>{h.lastDeployState}</StatusWord> : <span className="text-muted">—</span>}
                  <span className="mt-0.5 block text-[13px] text-muted md:hidden">{timeAgo(h.lastDeployAt)}</span>
                </td>
                <td className={`${cell({ wide: true })} whitespace-nowrap text-[13px] text-muted`}>{timeAgo(h.lastDeployAt)}</td>
                <td className={cell({ wide: true })}>{h.url ? <a href={h.url} target="_blank" rel="noreferrer" className="text-[13px] text-cyan hover:underline">{h.url.replace(/^https?:\/\//, "")} ↗</a> : <span className="text-muted">—</span>}</td>
              </tr>
            ))}
          </HudTable>
        )}
      </Card>
    </>
  );
}
