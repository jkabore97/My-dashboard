import type { CSSProperties } from "react";
import { requireSection } from "@/lib/server/auth";
import { getDashboard } from "@/lib/server/dashboard";
import { BizLabel, Card, PageHeader, SeverityBadge, timeAgo } from "@/components/ui";
import { Attention, cell, FilterChips, HudTable, MeterStat, StatusWord, tasksAsAttention, type StatusKind } from "@/components/web/hud";
import { formatBytes } from "@/components/web/logic";
import { SEVERITY_ORDER, type Database } from "@/lib/types";

const KIND: Record<Database["status"], StatusKind> = { healthy: "ok", degraded: "bad", paused: "idle", unknown: "idle" };
const PROVIDER: Record<Database["provider"], { label: string; color: string }> = {
  supabase: { label: "Supabase", color: "#3df5a0" },
  "cloudflare-d1": { label: "Cloudflare D1", color: "#ffd84d" },
  neon: { label: "Neon", color: "#2ef2d0" },
  other: { label: "Other", color: "#7f97ab" },
};

function ProviderTag({ p }: { p: Database["provider"] }) {
  const { label, color } = PROVIDER[p];
  return <span className="inline-flex border px-2 py-0.5 font-display text-[11px] font-bold uppercase tracking-[0.12em] whitespace-nowrap" style={{ color, borderColor: `color-mix(in srgb, ${color} 60%, transparent)` }}>{label}</span>;
}

function Cylinder({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 46 54" className="h-12 w-11 shrink-0" aria-hidden style={{ filter: `drop-shadow(0 0 6px ${color})` }}>
      <ellipse cx="23" cy="9" rx="19" ry="6" fill="none" stroke={color} strokeWidth="1.5" />
      <path d="M4 9v36c0 3.3 8.5 6 19 6s19-2.7 19-6V9" fill={`color-mix(in srgb, ${color} 8%, transparent)`} stroke={color} strokeWidth="1.5" />
      <path d="M4 21c0 3.3 8.5 6 19 6s19-2.7 19-6M4 33c0 3.3 8.5 6 19 6s19-2.7 19-6" fill="none" stroke={`color-mix(in srgb, ${color} 50%, transparent)`} />
    </svg>
  );
}

const worst = (d: Database) => Math.min(...(d.advisories ?? []).map((a) => SEVERITY_ORDER.indexOf(a.level)), 9);

export default async function DatabasesPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  await requireSection("databases");
  const s = await getDashboard();
  const { show } = await searchParams;

  const supa = s.databases.filter((d) => d.provider === "supabase");
  const d1 = s.databases.filter((d) => d.provider === "cloudflare-d1");
  const key = show === "supabase" || show === "d1" ? show : "all";
  const dbs = key === "supabase" ? supa : key === "d1" ? d1 : s.databases;

  const providers = new Set(s.databases.map((d) => d.provider)).size;
  const healthy = s.databases.filter((d) => d.status === "healthy").length;
  const paused = s.databases.filter((d) => d.status === "paused").length;
  const advs = s.databases.flatMap((d) => d.advisories ?? []);
  const serious = advs.filter((a) => a.level === "critical" || a.level === "high").length;
  const sized = s.databases.filter((d) => typeof d.sizeBytes === "number");
  const storage = sized.reduce((n, d) => n + (d.sizeBytes ?? 0), 0);
  const largest = Math.max(1, ...sized.map((d) => d.sizeBytes ?? 0));
  const attention = tasksAsAttention(s.openTasks, "databases");

  // Featured: anything unhealthy or with the worst findings first, then the largest.
  const featured = [...dbs].sort((a, b) => Number(b.status === "degraded") - Number(a.status === "degraded") || worst(a) - worst(b) || (b.sizeBytes ?? -1) - (a.sizeBytes ?? -1)).slice(0, 3);

  return (
    <>
      <PageHeader mode={s.modes.supabase === "live" || s.modes.d1 === "live" ? "live" : s.modes.supabase} title="Databases" subtitle="Supabase projects (with security and performance advisors) and Cloudflare D1.">
        {supa.length > 0 && d1.length > 0 && <FilterChips base="/databases" active={key} items={[{ key: "all", label: "All", count: s.databases.length }, { key: "supabase", label: "Supabase", count: supa.length }, { key: "d1", label: "D1", count: d1.length }]} />}
      </PageHeader>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-5">
        <MeterStat accent="violet" tone="violet" label="Databases" value={s.databases.length} hint={`${providers} provider${providers === 1 ? "" : "s"}`} />
        <MeterStat accent="emerald" tone="ok" label="Healthy" value={healthy} of={s.databases.length || undefined} hint={paused ? `${paused} paused (inactive)` : "none paused"} bar={s.databases.length ? healthy / s.databases.length : null} />
        <MeterStat accent="cyan" tone={serious ? "high" : "cyan"} label="Advisories" value={advs.length} hint={advs.length ? (serious ? `${serious} critical or high` : "medium / low only") : "no advisor findings"} />
        <MeterStat accent="gold" tone="gold" label="Storage used" value={sized.length ? formatBytes(storage) : "—"} hint={sized.length ? `${sized.length} database${sized.length === 1 ? "" : "s"} that report size (D1)` : "no platform reports size"} />
      </div>

      {featured.length > 0 && (
        <div className="mb-5 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {featured.map((d) => {
            const { color } = PROVIDER[d.provider];
            return (
              <div key={d.id} className="hud-panel flex flex-col p-4 sm:p-5" style={{ "--a": color } as CSSProperties}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-display text-lg font-semibold tracking-[0.04em] text-[#eaf7ff]">{d.name}</div>
                    <div className="mt-0.5">{d.business ? <BizLabel name={d.business} /> : <span className="text-xs text-muted">No business assigned</span>}</div>
                  </div>
                  <Cylinder color={color} />
                </div>
                <dl className="mt-4 divide-y divide-line/50 text-[13px]">
                  <div className="flex justify-between gap-3 py-1.5"><dt className="text-muted">Provider</dt><dd className="truncate font-mono text-xs">{PROVIDER[d.provider].label}{d.engine && d.provider !== "cloudflare-d1" ? ` · ${d.engine}` : ""}</dd></div>
                  {d.region && <div className="flex justify-between gap-3 py-1.5"><dt className="text-muted">Region</dt><dd className="font-mono text-xs">{d.region}</dd></div>}
                  {d.tables != null && <div className="flex justify-between gap-3 py-1.5"><dt className="text-muted">Tables</dt><dd className="font-mono text-xs tabular-nums">{d.tables}</dd></div>}
                  <div className="flex justify-between gap-3 py-1.5"><dt className="text-muted">Status</dt><dd><StatusWord kind={KIND[d.status]}>{d.status}</StatusWord></dd></div>
                  {d.provider === "supabase" && <div className="flex justify-between gap-3 py-1.5"><dt className="text-muted">Advisor findings</dt><dd className="font-mono text-xs tabular-nums">{d.advisories?.length ?? 0}</dd></div>}
                </dl>
                {typeof d.sizeBytes === "number" && (
                  <div className="mt-auto pt-3">
                    <div className="mb-1.5 flex justify-between text-xs"><span className="text-muted">Database size</span><span className="font-mono tabular-nums">{formatBytes(d.sizeBytes)}</span></div>
                    <div className="h-1.5 bg-white/5" title="Relative to your largest database that reports size"><div className="h-full" style={{ width: `${Math.max(2, (d.sizeBytes / largest) * 100)}%`, background: `linear-gradient(90deg, ${color}, color-mix(in srgb, ${color} 40%, #2ef2d0))`, boxShadow: `0 0 8px ${color}` }} /></div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Attention items={attention} foot={s.openTasks.some((t) => t.fix === "Restore project") ? "Restore project acts on Supabase with your connected account, after you confirm. Nothing in a paused project is lost." : undefined} />

      <Card accent="violet" flush title="All databases" action="latest from Supabase and Cloudflare">
        {dbs.length === 0 ? <p className="py-8 text-center text-sm text-muted">Connect Supabase or Cloudflare on the Platforms page to list your databases.</p> : (
          <HudTable head={[{ label: "Database" }, { label: "Provider", wide: true }, { label: "Business", wide: true }, { label: "Region", wide: true }, { label: "Size", wide: true, right: true }, { label: "Status" }, { label: "Advisories" }, { label: "Created", wide: true }]}>
            {dbs.map((d) => (
              <tr key={d.id}>
                <td className={cell()}>
                  {d.provider === "supabase" ? <a href={`https://supabase.com/dashboard/project/${d.id}`} target="_blank" rel="noreferrer" className="font-medium text-[#eaf7ff] hover:text-violet">{d.name} ↗</a> : <span className="font-medium text-[#eaf7ff]">{d.name}</span>}
                  <span className="block text-[11px] text-muted">{d.provider === "supabase" ? `ref ${d.id.slice(0, 4)}…${d.id.slice(-4)}` : d.engine ?? ""}<span className="md:hidden"> · {PROVIDER[d.provider].label}</span></span>
                </td>
                <td className={cell({ wide: true })}><ProviderTag p={d.provider} /></td>
                <td className={cell({ wide: true })}>{d.business ? <BizLabel name={d.business} /> : <span className="text-muted">—</span>}</td>
                <td className={`${cell({ wide: true })} font-mono text-xs text-muted`}>{d.region ?? "—"}</td>
                <td className={`${cell({ wide: true, right: true })} font-mono text-xs tabular-nums ${typeof d.sizeBytes === "number" ? "" : "text-muted"}`}>{typeof d.sizeBytes === "number" ? formatBytes(d.sizeBytes) : "—"}</td>
                <td className={cell()}><StatusWord kind={KIND[d.status]}>{d.status}</StatusWord></td>
                <td className={cell()}>
                  {d.advisories?.length ? (
                    <ul className="space-y-1">{d.advisories.slice(0, 3).map((a, i) => <li key={i} className="flex items-center gap-2 text-xs"><span title={a.title}><SeverityBadge severity={a.level} /></span><span className="line-clamp-1 hidden md:inline">{a.title}</span></li>)}{d.advisories.length > 3 && <li className="text-xs text-muted">+{d.advisories.length - 3} more</li>}</ul>
                  ) : <span className="text-muted">—</span>}
                </td>
                <td className={`${cell({ wide: true })} whitespace-nowrap text-xs text-muted`}>{timeAgo(d.createdAt)}</td>
              </tr>
            ))}
          </HudTable>
        )}
      </Card>
    </>
  );
}
