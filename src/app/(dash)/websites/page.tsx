import Link from "next/link";
import { requireSection } from "@/lib/server/auth";
import { isFullOwner } from "@/lib/access";
import { getDashboard } from "@/lib/server/dashboard";
import { snapshotHistory } from "@/lib/server/store/snapshots";
import { demoUptimeHistory } from "@/lib/demo";
import { BizLabel, btn, businessColor, Card, PageHeader, timeAgo } from "@/components/ui";
import { UptimeStrip, type UptimePoint } from "@/components/UptimeStrip";
import { Attention, BarRows, cell, FilterChips, HudTable, MeterStat, Note, StatusWord, tasksAsAttention, type StatusKind } from "@/components/web/hud";
import { MultiLine } from "@/components/web/MultiLine";
import { medianResponse } from "@/components/web/logic";
import type { Website } from "@/lib/types";

const STATUS: Record<Website["status"], StatusKind> = { up: "ok", degraded: "warn", down: "bad", unknown: "idle" };
const shared = (domain: string) => domain.endsWith(".vercel.app");
const short = (domain: string) => domain.replace(/\.vercel\.app$/, "");
const DAYS = 30;

export default async function WebsitesPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const user = await requireSection("websites");
  const s = await getDashboard();
  const { show } = await searchParams;
  const now = Date.now();

  // One read covers the 24-hour strips, the response chart and the 30-day bars
  // (snapshots are kept for 30 days). Sample sites get sample checks.
  const history = new Map<string, UptimePoint[]>();
  const rows = s.modes.websites === "live" ? (s.dbError ? [] : await snapshotHistory<Omit<UptimePoint, "takenAt">>("website", DAYS * 24).catch(() => [])) : demoUptimeHistory(s.websites, now);
  for (const h of rows) {
    const list = history.get(h.key) ?? [];
    list.push({ status: h.data.status, responseMs: h.data.responseMs, takenAt: h.takenAt });
    history.set(h.key, list);
  }
  const last = rows.length ? rows.reduce((a, b) => (a.takenAt > b.takenAt ? a : b)).takenAt : null;

  const vercelCount = s.websites.filter((w) => shared(w.domain)).length;
  const filter = show === "custom" || show === "vercel" ? show : "all";
  const sites = s.websites.filter((w) => filter === "all" || (filter === "vercel") === shared(w.domain));

  const online = sites.filter((w) => w.status === "up").length;
  const withUsers = sites.filter((w) => w.totalUsers != null);
  const total = withUsers.reduce((n, w) => n + (w.totalUsers ?? 0), 0);
  const fresh = sites.reduce((n, w) => n + (w.newUsers7d ?? 0), 0);
  const withVisitors = sites.filter((w) => w.visitors7d != null);
  const visitors = withVisitors.reduce((n, w) => n + (w.visitors7d ?? 0), 0);
  const visibleDomains = new Set(sites.map((w) => w.domain));

  const attention = [
    ...tasksAsAttention(s.openTasks, "websites"),
    // Certificate and registration problems on these sites live on Domains; surface the serious ones here too.
    ...tasksAsAttention(s.openTasks.filter((t) => /^domains\/(certificate|registration):/.test(t.sourceKey ?? t.id) && [...visibleDomains].some((d) => t.title.includes(d))), "domains"),
  ];

  const hourStart = now - 24 * 3_600_000;
  const BUCKETS = 48;
  const timeLabels = Array.from({ length: BUCKETS }, (_, i) => new Date(hourStart + (i + 0.5) * (24 * 3_600_000) / BUCKETS).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false }));
  const series = sites
    .map((w) => ({ name: short(w.domain), color: businessColor(w.business), values: medianResponse(history.get(w.domain) ?? [], hourStart, now, BUCKETS) }))
    .filter((x) => x.values.some((v) => v != null))
    .slice(0, 6);
  // Two sites of one business would share a color; keep lines apart by nudging repeats to other palette slots.
  const PALETTE = ["#3fd0ff", "#ff5fd7", "#2ef2d0", "#a98bff", "#ffd84d", "#c6f432"];
  const seen = new Set<string>();
  series.forEach((x, i) => {
    if (seen.has(x.color)) x.color = PALETTE.find((c) => !seen.has(c)) ?? PALETTE[i % PALETTE.length];
    seen.add(x.color);
  });

  const users = [...withUsers].sort((a, b) => (b.totalUsers ?? 0) - (a.totalUsers ?? 0));
  const noUsers = sites.filter((w) => w.totalUsers == null);

  return (
    <>
      <PageHeader mode={s.modes.websites} title="Websites & users" subtitle="Uptime checked every 5 minutes, plus sign-ups from each site's Supabase auth.">
        {vercelCount > 0 && vercelCount < s.websites.length && (
          <FilterChips base="/websites" active={filter} items={[{ key: "all", label: "All", count: s.websites.length }, { key: "custom", label: "Custom domain", count: s.websites.length - vercelCount }, { key: "vercel", label: "vercel.app", count: vercelCount }]} />
        )}
        {isFullOwner(user) && <Link href="/settings#websites" className={`${btn()} min-h-10 sm:min-h-0`} style={{ "--b": "#ff5fd7" } as React.CSSProperties}>Edit sites →</Link>}
      </PageHeader>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-5">
        <MeterStat accent="teal" label="Sites online" value={online} of={sites.length} tone={online === sites.length ? "teal" : "high"} hint={last ? `last check ${timeAgo(last)}` : "no checks yet"} bar={sites.length ? online / sites.length : null} />
        <MeterStat accent="cyan" label="Registered users" value={withUsers.length ? total.toLocaleString() : "—"} tone="cyan" hint={withUsers.length ? `across ${withUsers.length} Supabase project${withUsers.length === 1 ? "" : "s"}` : "link a Supabase project in Settings"} />
        <MeterStat accent="emerald" label="New users · 7 d" value={withUsers.length ? `+${fresh.toLocaleString()}` : "—"} tone="ok" hint={withUsers.length && total ? `${((fresh / total) * 100).toFixed(1)}% of all users` : undefined} />
        <MeterStat accent="violet" label="Visitors · 7 d" value={withVisitors.length ? visitors.toLocaleString() : "—"} tone="violet" hint={withVisitors.length ? `Google Analytics · ${withVisitors.length} propert${withVisitors.length === 1 ? "y" : "ies"}` : "connect Google Analytics"} />
      </div>

      <Attention items={attention} />

      <Card accent="teal" flush className="mb-5" title="Fleet status · last 24 hours" action="48 slots · 30 min each">
        {sites.length === 0 ? <p className="py-8 text-center text-sm text-muted">Add websites in Settings to start checking them.</p> : (
          <HudTable head={[{ label: "Site" }, { label: "Business", wide: true }, { label: "Status", wide: true }, { label: "Last 24 hours" }, { label: "Response", wide: true }, { label: "Users", wide: true, right: true }, { label: "New 7d", right: true }]}>
            {sites.map((w) => (
              <tr key={w.id}>
                <td className={cell()}>
                  <a href={`https://${w.domain}`} target="_blank" rel="noreferrer" className="[overflow-wrap:anywhere] font-medium text-[#eaf7ff] hover:text-teal">{w.domain}</a>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 md:hidden"><BizLabel name={w.business} />{w.status !== "up" && <StatusWord kind={STATUS[w.status]}>{w.status}</StatusWord>}</div>
                </td>
                <td className={cell({ wide: true })}><BizLabel name={w.business} /></td>
                <td className={cell({ wide: true })}><StatusWord kind={STATUS[w.status]}>{w.status}</StatusWord></td>
                <td className={`${cell()} w-[38%] min-w-[96px] md:w-auto md:min-w-[200px]`}><UptimeStrip points={history.get(w.domain) ?? []} now={now} showPct={false} /></td>
                <td className={cell({ wide: true })}>
                  {w.responseMs != null ? (
                    <span className="inline-flex items-center gap-2 font-mono text-xs tabular-nums">
                      <span className="w-14">{w.responseMs} ms</span>
                      <span className="h-1" style={{ width: Math.min(80, Math.max(4, Math.round(w.responseMs / 6))), background: w.responseMs > 1200 ? "#ff9f1c" : "linear-gradient(90deg,#2ef2d0,#3fd0ff)", boxShadow: `0 0 6px ${w.responseMs > 1200 ? "#ff9f1c" : "#2ef2d0"}` }} />
                    </span>
                  ) : <span className="text-muted">—</span>}
                </td>
                <td className={`${cell({ wide: true, right: true })} font-mono text-xs tabular-nums`}>{w.totalUsers?.toLocaleString() ?? <span className="text-muted">—</span>}</td>
                <td className={`${cell({ right: true })} font-mono text-xs tabular-nums ${w.newUsers7d ? "text-emerald" : "text-muted"}`}>{w.newUsers7d != null ? `+${w.newUsers7d}` : "—"}</td>
              </tr>
            ))}
          </HudTable>
        )}
        {vercelCount > 0 && <Note>Shared-host <b className="font-medium text-ink">*.vercel.app</b> sites get uptime checks only. Domain, SSL and email checks run on custom domains (see <Link href="/domains" className="font-medium text-ink hover:text-teal">Domains</Link>).</Note>}
      </Card>

      <div className="mb-5 grid gap-5 xl:grid-cols-2">
        <Card accent="cyan" title="Response time · 24 h" action="median ms per 30 min">
          <MultiLine series={series} labels={timeLabels} unit="ms" label="Median response time per site over the last 24 hours" />
        </Card>
        <Card accent="violet" flush title="Users by site" action="Supabase auth · total">
          <div className="p-4 sm:p-5">
            {users.length ? (
              <BarRows rows={users.map((w) => ({ key: w.domain, label: short(w.domain), sub: w.newUsers7d != null ? `+${w.newUsers7d} this week` : undefined, value: w.totalUsers ?? 0, color: businessColor(w.business) }))} />
            ) : <p className="py-6 text-center text-sm text-muted">No sign-up counts yet: add each site&apos;s Supabase project ref in Settings → Websites.</p>}
          </div>
          {users.length > 0 && noUsers.length > 0 && (
            <div className="border-t border-line/70 px-4 py-3 text-xs text-muted sm:px-5">
              {noUsers.length} site{noUsers.length === 1 ? " has" : "s have"} no sign-up count: {noUsers.map((w, i) => <span key={w.id}>{i ? ", " : ""}<b className="font-medium text-ink">{short(w.domain)}</b></span>)} (no Supabase project linked).
            </div>
          )}
        </Card>
      </div>

      <Card accent="teal" title={`Uptime · ${DAYS} days`} action="one bar = 12 hours">
        {sites.length === 0 ? <p className="py-6 text-center text-sm text-muted">No sites yet.</p> : (
          <ul className="space-y-2.5">
            {sites.map((w) => (
              <li key={w.id} className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-3 text-[12.5px] sm:grid-cols-[11rem_minmax(0,1fr)]">
                <span className="truncate" title={w.domain}>{short(w.domain)}</span>
                <UptimeStrip points={history.get(w.domain) ?? []} hours={DAYS * 24} buckets={60} now={now} />
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-muted">Each bar shows the worst result in its 12 hours; hover for details. Check history is kept for {DAYS} days.</p>
      </Card>
    </>
  );
}
