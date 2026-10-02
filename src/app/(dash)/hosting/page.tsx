import { businessTimeZone } from "@/lib/dates";
import type { CSSProperties, ReactNode } from "react";
import { requireSection } from "@/lib/server/auth";
import { getDashboard } from "@/lib/server/dashboard";
import { BizLabel, Card, PageHeader, timeAgo } from "@/components/ui";
import { Attention, cell, FilterChips, HudTable, StatusWord, tasksAsAttention, type StatusKind } from "@/components/web/hud";
import { averageBuildMs, deployMarks, hasDeployHistory } from "@/components/web/logic";
import type { DeployState, HostingProject } from "@/lib/types";

const KIND: Record<DeployState, StatusKind> = { ready: "ok", building: "info", queued: "info", error: "bad", canceled: "idle" };
const MARK: Record<string, string> = { vercel: "#eaf7ff", cloudflare: "#ffd84d" };
const FRAMEWORK: Record<string, string> = { nextjs: "Next.js", vite: "Vite", astro: "Astro", remix: "Remix", sveltekit: "SvelteKit", nuxtjs: "Nuxt", gatsby: "Gatsby", workers: "Worker" };

function ProviderTag({ p }: { p: HostingProject["provider"] }) {
  const c = p === "vercel" ? "#eaf7ff" : p === "cloudflare" ? "#ffd84d" : "#7f97ab";
  return <span className="inline-flex items-center gap-1.5 border px-2 py-0.5 font-display text-[11px] font-bold uppercase tracking-[0.12em] whitespace-nowrap" style={{ color: c, borderColor: `color-mix(in srgb, ${c} 60%, transparent)` }}>{p === "vercel" ? "▲" : p === "cloudflare" ? "☁" : "•"} {p}</span>;
}

function Kpi({ v, l, c }: { v: ReactNode; l: string; c?: string }) {
  return (
    <div>
      <b className="block font-display text-2xl font-semibold tabular-nums" style={{ color: c ?? "#eaf7ff", textShadow: c ? `0 0 12px color-mix(in srgb, ${c} 45%, transparent)` : undefined }}>{v}</b>
      <span className="hud-label text-[10.5px] text-muted">{l}</span>
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
        <div style={{ "--ga": "#eaf7ff" } as CSSProperties}>
          <Card title="Vercel" action={s.modes.vercel === "live" ? "connected" : s.modes.vercel === "error" ? "connection failing" : "not connected"}>
            <div className="flex items-center gap-5">
              <div className="hud-cut hidden h-16 w-16 shrink-0 place-items-center sm:grid border border-white/40 bg-white/5 text-3xl text-[#eaf7ff]" aria-hidden>▲</div>
              <div className="grid flex-1 grid-cols-2 gap-4 sm:grid-cols-4">
                <Kpi v={vercel.length} l="projects" />
                <Kpi v={vercel.filter((h) => h.lastDeployState === "ready").length} l="ready" c="#3df5a0" />
                <Kpi v={history ? vercelDeploys : "—"} l="deploys · 24 h" c="#3fd0ff" />
                <Kpi v={avg != null ? `${Math.round(avg / 1000)} s` : "—"} l="avg build" />
              </div>
            </div>
          </Card>
        </div>
        <Card accent="gold" title="Cloudflare Workers" action={s.modes.workers === "live" ? "connected" : s.modes.workers === "error" ? "connection failing" : "not connected"}>
          <div className="flex items-center gap-5">
            <div className="hud-cut hidden h-16 w-16 shrink-0 place-items-center sm:grid border border-gold/50 bg-gold/10 text-gold" aria-hidden>
              <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M7 18h11a4 4 0 00.5-8 6 6 0 00-11.6 1.5A3.3 3.3 0 007 18z" /></svg>
            </div>
            <div className="grid flex-1 grid-cols-2 gap-4 sm:grid-cols-3">
              <Kpi v={workers.length} l="workers" />
              <Kpi v={workers.filter((w) => w.lastDeployState === "ready").length} l="deployed" c="#3df5a0" />
              <Kpi v={updatedWeek} l="updated · 7 d" c="#ffd84d" />
            </div>
          </div>
        </Card>
      </div>

      <div className="mb-5 grid items-start gap-5 xl:grid-cols-2">
        <Card accent="cyan" title="Production deploys · last 24 h" action={`${marks.length} deploy${marks.length === 1 ? "" : "s"} · ${failed} failed`}>
          {marks.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">{history || workers.length ? "No production deploys in the last 24 hours." : "Deploy history appears once Vercel is connected."}</p>
          ) : (
            <>
              <div className="relative h-20 border-b border-line" role="img" aria-label={`${marks.length} production deploys in the last 24 hours, ${failed} failed`}>
                {marks.map((m, i) => {
                  const c = m.state === "error" ? "#ff3d6e" : m.state === "building" || m.state === "queued" ? "#3fd0ff" : MARK[m.provider] ?? "#eaf7ff";
                  return (
                    <span key={`${m.project}-${m.at}-${i}`} title={`${m.project} · ${m.state ?? "unknown"} · ${timeAgo(m.at)}`} className="absolute bottom-0 w-[2px] -translate-x-1/2" style={{ left: `${m.frac * 100}%`, height: `${40 + ((i * 37) % 5) * 9}%`, background: c }}>
                      <span className={`absolute -left-[4px] -top-[5px] block h-2.5 w-2.5 ${m.state === "error" ? "rotate-45" : "rounded-full"}`} style={{ background: c, boxShadow: `0 0 8px ${c}` }} />
                    </span>
                  );
                })}
              </div>
              <div className="mt-1.5 flex justify-between font-mono text-[10px] text-muted">{hours.map((h) => <span key={h}>{h}</span>)}</div>
              <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-[#c5d3de]">
                <li className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-[#eaf7ff]" />Vercel ready</li>
                <li className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-gold" />Worker deployed</li>
                <li className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-cyan" />Building</li>
                {failed > 0 && <li className="flex items-center gap-1.5"><i className="h-2 w-2 rotate-45 bg-critical" />Failed</li>}
              </ul>
              {!history && vercel.length > 0 && <p className="mt-2 text-xs text-muted">Vercel&apos;s deploy history couldn&apos;t be read this time; only Workers are shown.</p>}
            </>
          )}
        </Card>

        {fixes.length ? (
          <Attention title="One-click fixes" items={fixes} foot="Redeploy rebuilds the same commit and config with your connected account, after you confirm." />
        ) : (
          <Card accent="emerald" title="One-click fixes" action="nothing to fix">
            <div className="flex items-start gap-4">
              <span className="grid h-10 w-10 shrink-0 place-items-center border border-emerald/60 text-emerald shadow-[0_0_12px_rgb(61_245_160/0.3)]" aria-hidden>✓</span>
              <div>
                <div className="text-[15px] font-medium">Every production deploy is healthy</div>
                <p className="mt-0.5 text-[12.5px] text-muted">When a Vercel production deploy fails, a <b className="font-medium text-ink">Redeploy</b> button shows here and on the alert. It rebuilds the same commit and config with your connected account, after you confirm.</p>
              </div>
            </div>
          </Card>
        )}
      </div>

      <Card accent="violet" flush title="Projects" action="latest production deploy">
        {list.length === 0 ? <p className="py-8 text-center text-sm text-muted">Connect Vercel or Cloudflare on the Platforms page to list your projects.</p> : (
          <HudTable head={[{ label: "Project" }, { label: "Provider", wide: true }, { label: "Business", wide: true }, { label: "Last deploy" }, { label: "When", wide: true }, { label: "URL", wide: true }]}>
            {list.map((h) => (
              <tr key={h.id}>
                <td className={cell()}>
                  <span className="font-medium text-[#eaf7ff]">{h.name}</span>
                  <span className="block text-[11px] text-muted">{h.framework ? FRAMEWORK[h.framework] ?? h.framework : h.provider === "cloudflare" ? "Worker" : ""}<span className="md:hidden">{h.business ? ` · ${h.business}` : ""}</span></span>
                </td>
                <td className={cell({ wide: true })}><ProviderTag p={h.provider} /></td>
                <td className={cell({ wide: true })}>{h.business ? <BizLabel name={h.business} /> : <span className="text-muted">—</span>}</td>
                <td className={cell()}>
                  {h.lastDeployState ? <StatusWord kind={KIND[h.lastDeployState]}>{h.lastDeployState}</StatusWord> : <span className="text-muted">—</span>}
                  <span className="mt-0.5 block text-[11px] text-muted md:hidden">{timeAgo(h.lastDeployAt)}</span>
                </td>
                <td className={`${cell({ wide: true })} whitespace-nowrap text-xs text-muted`}>{timeAgo(h.lastDeployAt)}</td>
                <td className={cell({ wide: true })}>{h.url ? <a href={h.url} target="_blank" rel="noreferrer" className="font-mono text-xs text-teal hover:underline">{h.url.replace(/^https?:\/\//, "")} ↗</a> : <span className="text-muted">—</span>}</td>
              </tr>
            ))}
          </HudTable>
        )}
      </Card>
    </>
  );
}
