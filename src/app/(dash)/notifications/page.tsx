import { requireSection } from "@/lib/server/auth";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { getDashboard } from "@/lib/server/dashboard";
import { businessTimeZone, today } from "@/lib/dates";
import { canSee, isFullOwner } from "@/lib/access";
import { deliveryLog } from "@/lib/server/alerts/store";
import { DeliveryLog } from "@/components/alerts/DeliveryLog";
import { SEVERITY_ORDER, type Severity } from "@/lib/types";
import { BizLabel, Card, Empty, PageHeader, SeverityIcon, businessColor, timeAgo } from "@/components/ui";
import { Chip, ChipRow, KpiStrip, SEV_COLOR, SEV_WORD } from "@/components/command/hud";
import { eventVolume, groupByDay, severityCounts, sourceCounts, sourceName } from "@/components/command/logic";

/** "GitHub" → "GH", "Stripe" → "S", "Google reviews" → "GR". */
const initials = (name: string) => {
  const caps = name.match(/[A-Z]/g) ?? [];
  return (caps.length >= 2 ? caps.slice(0, 2).join("") : name.slice(0, 1).toUpperCase()) || "?";
};

const BAR = ["#a98bff", "#3fd0ff", "#2ef2d0", "#ff5fd7", "#c6f432", "#ffd84d", "#3df5a0"];

function SourceMark({ name }: { name: string }) {
  const c = businessColor(name);
  return <span title={name} className="inline-grid h-[18px] min-w-[18px] shrink-0 place-items-center border px-0.5 font-display text-[9.5px] font-bold" style={{ color: c, borderColor: `color-mix(in srgb, ${c} 70%, transparent)` }}>{initials(name)}</span>;
}

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ severity?: string; source?: string }> }) {
  const user = await requireSection("notifications");
  const params = await searchParams;
  const s = await getDashboard();
  const everyone = isFullOwner(user);
  const deliveries = await deliveryLog(user, everyone, everyone ? 100 : 50).catch(() => []);
  const tz = businessTimeZone();
  const nowMs = Date.now();
  const sev = SEVERITY_ORDER.includes(params.severity as Severity) ? (params.severity as Severity) : null;
  const src = params.source || null;

  const all = s.notifications;
  const bySource = src ? all.filter((n) => sourceName(n.source) === src) : all;
  const list = sev ? bySource.filter((n) => n.severity === sev) : bySource;
  const day24 = all.filter((n) => Date.parse(n.at) > nowMs - 86_400_000);
  const sources24 = sourceCounts(all, nowMs - 86_400_000);
  const sourcesAll = sourceCounts(all, 0);
  const sideSources = sources24.length ? sources24 : sourceCounts(all, nowMs - 14 * 86_400_000);
  const maxSource = Math.max(1, ...sideSources.map((x) => x.count));
  const volume = eventVolume(all, 14, tz);
  const maxDay = Math.max(1, ...volume.map((v) => v.critical + v.high + v.medium + v.low));
  const sevCounts = severityCounts(bySource);
  const showTasks = canSee(user, "tasks");
  const openBad = s.openTasks.filter((t) => t.severity === "critical" || t.severity === "high");
  const openCrit = s.openTasks.filter((t) => t.severity === "critical");
  const openHigh = s.openTasks.filter((t) => t.severity === "high");
  const now = today(tz);
  const yesterday = today(tz, new Date(nowMs - 86_400_000));

  const href = (next: { severity?: Severity | null; source?: string | null }) => {
    const q = new URLSearchParams();
    const v = "severity" in next ? next.severity : sev;
    const o = "source" in next ? next.source : src;
    if (v) q.set("severity", v);
    if (o) q.set("source", o);
    const qs = q.toString();
    return qs ? `/notifications?${qs}` : "/notifications";
  };
  const dayLabel = (d: string) => {
    const l = new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long", month: "short", day: "numeric" });
    return d === now ? `Today · ${l}` : d === yesterday ? `Yesterday · ${l}` : l;
  };

  return (
    <>
      <PageHeader title="Alerts" subtitle="Email, GitHub, Vercel, Stripe, Supabase and uptime events, newest first. Kept for 90 days." />

      <KpiStrip
        accent="#ff5fd7"
        className="mb-4 lg:mb-[22px]"
        items={[
          { label: "Last 24 h", value: day24.length, hint: `${sources24.length} source${sources24.length === 1 ? "" : "s"}`, c1: "#3fd0ff", c2: "#a98bff" },
          ...(showTasks
            ? [
                { label: "Critical open", value: openCrit.length, hint: openCrit[0]?.title ?? "none in To-do", c1: openCrit.length ? "#ff3d6e" : "#3df5a0", c2: openCrit.length ? "#ff7a9a" : "#2ef2d0", href: "/tasks" },
                { label: "High open", value: openHigh.length, hint: openHigh[0]?.title ?? "none in To-do", c1: openHigh.length ? "#ff9f1c" : "#3df5a0", c2: openHigh.length ? "#ffc56b" : "#2ef2d0", href: "/tasks" },
              ]
            : []),
          { label: "History", value: all.length.toLocaleString(), hint: "events kept · 90 days", c1: "#ffd84d", c2: "#3df5a0" },
        ]}
      />

      {all.length > 0 && (
        <div className="mb-4 grid gap-4 lg:mb-[22px] lg:gap-[22px] xl:grid-cols-[minmax(0,1fr)_340px]">
          <Card title="Event volume" accent="cyan" flush action="14 days · by severity">
            <div className="px-4 pb-4 pt-4 sm:px-5">
              <div className="flex h-44 items-end gap-1 sm:gap-2" role="img" aria-label={`Events per day over the last 14 days, most ${maxDay} in a day`}>
                {volume.map((v) => {
                  const total = v.critical + v.high + v.medium + v.low;
                  return (
                    <div key={v.day} className="flex h-full min-w-0 flex-1 flex-col justify-end" title={`${v.day}: ${total} event${total === 1 ? "" : "s"}${total ? ` (${SEVERITY_ORDER.filter((x) => v[x]).map((x) => `${v[x]} ${x}`).join(", ")})` : ""}`}>
                      {[...SEVERITY_ORDER].map((x) => (v[x] ? <i key={x} className="block w-full border-t border-bg/60" style={{ height: `${(v[x] / maxDay) * 100}%`, background: x === "low" ? "#4a6276" : x === "medium" ? "#2a9fd0" : SEV_COLOR[x], opacity: v.day === now ? 1 : 0.85 }} /> : null))}
                      {total === 0 && <i className="block h-px w-full bg-line" />}
                    </div>
                  );
                })}
              </div>
              <div className="mt-2 flex gap-1 font-mono text-[10.5px] text-muted sm:gap-2">
                {volume.map((v, i) => <span key={v.day} className={`min-w-0 flex-1 text-center ${v.day === now ? "text-cyan" : ""} ${i % 2 && v.day !== now ? "max-sm:invisible" : ""}`}>{v.day === now ? "today" : Number(v.day.slice(8))}</span>)}
              </div>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 font-display text-[11.5px] uppercase tracking-[0.12em] text-muted">
                {SEVERITY_ORDER.map((x) => <span key={x} className="inline-flex items-center gap-1.5"><SeverityIcon severity={x} size={13} />{SEV_WORD[x]}</span>)}
              </div>
            </div>
          </Card>

          <Card title="By source" accent="violet" flush action={sources24.length ? "last 24 h" : "last 14 days"}>
            {sideSources.length === 0 ? <Empty>Nothing in the last 14 days.</Empty> : (
              <div className="py-2">
                {sideSources.slice(0, 7).map((x, i) => (
                  <Link key={x.source} href={href({ source: x.source })} className="grid min-h-10 grid-cols-[22px_minmax(0,90px)_minmax(0,1fr)_28px] items-center gap-3 px-4 py-1.5 text-[13px] hover:bg-cyan/5 sm:px-5">
                    <SourceMark name={x.source} />
                    <span className="truncate">{x.source}</span>
                    <span className="h-2 bg-cyan/[0.08]"><i className="block h-full" style={{ width: `${(x.count / maxSource) * 100}%`, background: BAR[i % BAR.length], boxShadow: `0 0 6px ${BAR[i % BAR.length]}` }} /></span>
                    <span className="text-right font-mono tabular-nums">{x.count}</span>
                  </Link>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      <div className="mb-5 grid gap-2.5">
        <ChipRow label="Severity">
          <Chip href={href({ severity: null })} active={!sev} count={bySource.length}>All</Chip>
          {SEVERITY_ORDER.map((x) => <Chip key={x} href={href({ severity: x })} active={sev === x} count={sevCounts[x]} dot={SEV_COLOR[x]}>{SEV_WORD[x]}</Chip>)}
        </ChipRow>
        {sourcesAll.length > 1 && (
          <ChipRow label="Source">
            <Chip href={href({ source: null })} active={!src}>All sources</Chip>
            {sourcesAll.map((x) => (
              <Chip key={x.source} href={href({ source: x.source })} active={src === x.source} count={x.count}>
                <SourceMark name={x.source} />{x.source}
              </Chip>
            ))}
          </ChipRow>
        )}
      </div>

      <div className={`grid items-start gap-4 lg:gap-[22px] ${showTasks ? "xl:grid-cols-[minmax(0,1fr)_340px]" : ""}`}>
        <Card title="History · newest first" accent="pink" flush action={`${src ?? "all sources"} · ${s.business ?? "all businesses"}`}>
          {list.length === 0 ? <Empty>{all.length ? "Nothing matches these filters." : "All quiet."}</Empty> : groupByDay(list, tz).map(([day, items]) => (
            <div key={day}>
              <div className="hud-label flex items-center gap-3 px-4 pb-1.5 pt-3.5 text-[11.5px] text-ink sm:px-5">
                {dayLabel(day)} <span className="text-muted">{items.length}</span><i className="h-px flex-1 bg-line" />
              </div>
              <ul>
                {items.map((n) => (
                  <li key={n.id} className="grid grid-cols-[26px_minmax(0,1fr)] items-start gap-x-3 border-b border-line/40 px-4 py-3 last:border-0 sm:grid-cols-[76px_26px_minmax(0,1fr)_auto] sm:gap-x-4 sm:px-5" style={n.severity === "critical" ? { boxShadow: "inset 2px 0 0 #ff3d6e", background: "linear-gradient(90deg, rgb(255 61 110 / .08), transparent 60%)" } : undefined}>
                    <div className="hidden font-mono text-[12px] leading-tight tabular-nums text-muted sm:block">
                      {new Date(n.at).toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" })}
                    </div>
                    <SeverityIcon severity={n.severity} size={24} />
                    <div className="min-w-0">
                      <div className="break-words text-[14px]">
                        {n.url ? <a href={n.url} target="_blank" rel="noreferrer" className="hover:text-cyan">{n.title}</a> : n.title}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-muted">
                        <span className="hud-label text-[10.5px] font-bold" style={{ color: SEV_COLOR[n.severity] }}>{SEV_WORD[n.severity]}</span>
                        <span className="inline-flex items-center gap-1.5"><SourceMark name={sourceName(n.source)} />{n.source}</span>
                        {n.body && <span className="min-w-0 max-w-full truncate">{n.body}</span>}
                        {n.business && !n.source.includes(n.business) && <BizLabel name={n.business} />}
                        <span className="font-mono tabular-nums sm:hidden">{timeAgo(n.at)}</span>
                      </div>
                    </div>
                    {n.url && <a href={n.url} target="_blank" rel="noreferrer" className="hud-label hidden items-center gap-1 text-[12px] text-cyan hover:underline sm:inline-flex">Open<ArrowUpRight size={12} /></a>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </Card>

        {showTasks && (
          <Card title="Still open" accent="pink" flush action={`${openBad.length} critical/high in To-do`}>
            {openBad.length === 0 ? <Empty>Nothing critical or high is open.</Empty> : (
              <ul>
                {openBad.slice(0, 6).map((t) => (
                  <li key={t.id} className="grid grid-cols-[16px_minmax(0,1fr)_auto] items-start gap-3 border-b border-line/50 px-4 py-2.5 text-[13px] last:border-0 sm:px-5">
                    <span className="mt-0.5"><SeverityIcon severity={t.severity} size={15} /></span>
                    <div className="min-w-0">
                      <div className="break-words">{t.title}</div>
                      <div className="truncate text-[11.5px] text-muted"><span style={{ color: SEV_COLOR[t.severity] }}>{SEV_WORD[t.severity]}</span>{t.business ? ` · ${t.business}` : ""}</div>
                    </div>
                    <span className="font-mono text-[11.5px] tabular-nums text-muted">{timeAgo(t.createdAt).replace(" ago", "")}</span>
                  </li>
                ))}
              </ul>
            )}
            <Link href="/tasks" className="hud-label block px-5 pb-4 pt-2 text-center text-[12px] text-cyan hover:underline">Open To-do →</Link>
          </Card>
        )}
      </div>

      <DeliveryLog rows={deliveries} everyone={everyone} timeZone={tz} />
    </>
  );
}
