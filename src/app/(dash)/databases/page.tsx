import { requireSection } from "@/lib/server/auth";
import { getDashboard } from "@/lib/server/dashboard";
import { BizLabel, Card, Empty, PageHeader, SeverityBadge, SYS, Tag, timeAgo } from "@/components/ui";
import { Attention, cell, FilterChips, HudTable, MeterStat, StatusWord, tasksAsAttention, type StatusKind } from "@/components/web/hud";
import { formatBytes } from "@/components/web/logic";
import { SEVERITY_ORDER, type Database } from "@/lib/types";

const KIND: Record<Database["status"], StatusKind> = { healthy: "ok", degraded: "bad", paused: "idle", unknown: "idle" };
const PROVIDER: Record<Database["provider"], { label: string; color: string }> = {
  supabase: { label: "Supabase", color: SYS.green },
  "cloudflare-d1": { label: "Cloudflare D1", color: SYS.cyan },
  neon: { label: "Neon", color: SYS.mint },
  other: { label: "Other", color: SYS.gray },
};

function ProviderTag({ p }: { p: Database["provider"] }) {
  const { label, color } = PROVIDER[p];
  return <Tag color={color}>{label}</Tag>;
}

function Cylinder({ color }: { color: string }) {
  return (
    <span aria-hidden className="grid h-11 w-11 shrink-0 place-items-center rounded-[10px] text-white" style={{ background: color }}>
      <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><ellipse cx="12" cy="5.5" rx="7.5" ry="2.8" /><path d="M4.5 5.5v13c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8v-13" /><path d="M4.5 12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8" /></svg>
    </span>
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

      <div className="mb-5 grid grid-cols-2 gap-2.5 sm:gap-4 lg:grid-cols-4">
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
              <div key={d.id} className="hud-panel flex flex-col p-4 sm:p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-[17px] font-semibold text-ink">{d.name}</div>
                    <div className="mt-0.5">{d.business ? <BizLabel name={d.business} /> : <span className="text-[13px] text-muted">No business assigned</span>}</div>
                  </div>
                  <Cylinder color={color} />
                </div>
                <dl className="mt-3 divide-y divide-line text-[15px]">
                  <div className="flex justify-between gap-3 py-1.5"><dt className="text-muted">Provider</dt><dd className="truncate text-muted">{PROVIDER[d.provider].label}{d.engine && d.provider !== "cloudflare-d1" ? ` · ${d.engine}` : ""}</dd></div>
                  {d.region && <div className="flex justify-between gap-3 py-1.5"><dt className="text-muted">Region</dt><dd className="text-muted">{d.region}</dd></div>}
                  {d.tables != null && <div className="flex justify-between gap-3 py-1.5"><dt className="text-muted">Tables</dt><dd className="tabular-nums text-muted">{d.tables}</dd></div>}
                  <div className="flex justify-between gap-3 py-1.5"><dt className="text-muted">Status</dt><dd><StatusWord kind={KIND[d.status]}>{d.status}</StatusWord></dd></div>
                  {d.provider === "supabase" && <div className="flex justify-between gap-3 py-1.5"><dt className="text-muted">Advisor findings</dt><dd className="tabular-nums text-muted">{d.advisories?.length ?? 0}</dd></div>}
                </dl>
                {typeof d.sizeBytes === "number" && (
                  <div className="mt-auto pt-3">
                    <div className="mb-1.5 flex justify-between text-[13px]"><span className="text-muted">Database size</span><span className="font-medium tabular-nums text-ink">{formatBytes(d.sizeBytes)}</span></div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-fill" title="Relative to your largest database that reports size"><div className="h-full rounded-full" style={{ width: `${Math.max(2, (d.sizeBytes / largest) * 100)}%`, background: color }} /></div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Attention items={attention} foot={s.openTasks.some((t) => t.fix === "Restore project") ? "Restore project acts on Supabase with your connected account, after you confirm. Nothing in a paused project is lost." : undefined} />

      <Card flush title="All databases" action="latest from Supabase and Cloudflare">
        {dbs.length === 0 ? <Empty>Connect Supabase or Cloudflare on the Platforms page to list your databases.</Empty> : (
          <HudTable head={[{ label: "Database" }, { label: "Provider", wide: true }, { label: "Business", wide: true }, { label: "Region", wide: true }, { label: "Size", wide: true, right: true }, { label: "Status" }, { label: "Advisories" }, { label: "Created", wide: true }]}>
            {dbs.map((d) => (
              <tr key={d.id}>
                <td className={cell()}>
                  {d.provider === "supabase" ? <a href={`https://supabase.com/dashboard/project/${d.id}`} target="_blank" rel="noreferrer" className="text-[15px] font-medium text-ink hover:text-cyan">{d.name} ↗</a> : <span className="text-[15px] font-medium text-ink">{d.name}</span>}
                  <span className="block text-[13px] text-muted">{d.provider === "supabase" ? `ref ${d.id.slice(0, 4)}…${d.id.slice(-4)}` : d.engine ?? ""}<span className="md:hidden"> · {PROVIDER[d.provider].label}</span></span>
                </td>
                <td className={`${cell({ wide: true })} whitespace-nowrap`}><ProviderTag p={d.provider} /></td>
                <td className={`${cell({ wide: true })} whitespace-nowrap`}>{d.business ? <BizLabel name={d.business} /> : <span className="text-muted">—</span>}</td>
                <td className={`${cell({ wide: true })} whitespace-nowrap text-[13px] text-muted`}>{d.region ?? "—"}</td>
                <td className={`${cell({ wide: true, right: true })} whitespace-nowrap text-[13px] tabular-nums ${typeof d.sizeBytes === "number" ? "" : "text-muted"}`}>{typeof d.sizeBytes === "number" ? formatBytes(d.sizeBytes) : "—"}</td>
                <td className={cell()}><StatusWord kind={KIND[d.status]}>{d.status}</StatusWord></td>
                <td className={cell()}>
                  {d.advisories?.length ? (
                    <ul className="space-y-1">{d.advisories.slice(0, 3).map((a, i) => <li key={i} className="flex items-center gap-2 text-[13px]"><span title={a.title}><SeverityBadge severity={a.level} /></span><span className="line-clamp-1 hidden md:inline">{a.title}</span></li>)}{d.advisories.length > 3 && <li className="text-[13px] text-muted">+{d.advisories.length - 3} more</li>}</ul>
                  ) : <span className="text-muted">—</span>}
                </td>
                <td className={`${cell({ wide: true })} whitespace-nowrap text-[13px] text-muted`}>{timeAgo(d.createdAt)}</td>
              </tr>
            ))}
          </HudTable>
        )}
      </Card>
    </>
  );
}
