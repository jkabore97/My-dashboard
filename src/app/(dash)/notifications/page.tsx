import { requireSection } from "@/lib/server/auth";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { getDashboard } from "@/lib/server/dashboard";
import { businessTimeZone, today } from "@/lib/dates";
import { canSee, isFullOwner } from "@/lib/access";
import { deliveryLog } from "@/lib/server/alerts/store";
import { DeliveryLog } from "@/components/alerts/DeliveryLog";
import { SEVERITY_ORDER, type Severity } from "@/lib/types";
import { BizLabel, CHART_COLORS, Card, Empty, Group, PageHeader, Row, SeverityIcon, SYS, businessColor, timeAgo } from "@/components/ui";
import { Chip, ChipRow, KpiStrip, SEV_COLOR, SEV_TEXT, SEV_WORD } from "@/components/command/hud";
import { eventVolume, groupByDay, severityCounts, sourceCounts, sourceName } from "@/components/command/logic";

/** "GitHub" → "GH", "Stripe" → "S", "Google reviews" → "GR". */
const initials = (name: string) => {
  const caps = name.match(/[A-Z]/g) ?? [];
  return (caps.length >= 2 ? caps.slice(0, 2).join("") : name.slice(0, 1).toUpperCase()) || "?";
};

function SourceMark({ name }: { name: string }) {
  const c = businessColor(name);
  return <span title={name} className="inline-grid h-[18px] min-w-[18px] shrink-0 place-items-center rounded-[5px] px-[3px] text-[10px] font-bold leading-none text-white" style={{ background: c }}>{initials(name)}</span>;
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

  const ring = "shadow-[0_0_0_1px_var(--color-line)]";

  return (
    <>
      <PageHeader title="Alerts" subtitle="Email, GitHub, Vercel, Stripe, Supabase and uptime events, newest first. Kept for 90 days." />

      <KpiStrip
        className="mb-6"
        items={[
          { label: "Last 24 h", value: day24.length, hint: `${sources24.length} source${sources24.length === 1 ? "" : "s"}`, c1: SYS.gray },
          ...(showTasks
            ? [
                { label: "Critical open", value: openCrit.length, hint: openCrit[0]?.title ?? "None in To-do", c1: openCrit.length ? SEV_COLOR.critical : SYS.gray, href: "/tasks" },
                { label: "High open", value: openHigh.length, hint: openHigh[0]?.title ?? "None in To-do", c1: openHigh.length ? SEV_COLOR.high : SYS.gray, href: "/tasks" },
              ]
            : []),
          { label: "History", value: all.length.toLocaleString(), hint: "events kept · 90 days", c1: SYS.gray },
        ]}
      />

      {all.length > 0 && (
        <div className="mb-7 grid gap-4 sm:gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
          <Card title="Event volume" flush action="14 days · by severity">
            <div className="px-4 pb-4 pt-4 sm:px-5">
              <div className="flex h-40 items-end gap-1 sm:gap-2" role="img" aria-label={`Events per day over the last 14 days, most ${maxDay} in a day`}>
                {volume.map((v) => {
                  const total = v.critical + v.high + v.medium + v.low;
                  return (
                    <div key={v.day} className="flex h-full min-w-0 flex-1 flex-col justify-end gap-px overflow-hidden" title={`${v.day}: ${total} event${total === 1 ? "" : "s"}${total ? ` (${SEVERITY_ORDER.filter((x) => v[x]).map((x) => `${v[x]} ${x}`).join(", ")})` : ""}`}>
                      {[...SEVERITY_ORDER].map((x, i, arr) => (v[x] ? <i key={x} className={`block w-full ${arr.slice(0, i).every((y) => !v[y]) ? "rounded-t-[3px]" : ""}`} style={{ height: `${(v[x] / maxDay) * 100}%`, background: SEV_COLOR[x], opacity: v.day === now ? 1 : 0.8 }} /> : null))}
                      {total === 0 && <i className="block h-0.5 w-full rounded-full bg-fill-2" />}
                    </div>
                  );
                })}
              </div>
              <div className="mt-2 flex gap-1 text-[11px] tabular-nums text-muted sm:gap-2">
                {volume.map((v, i) => <span key={v.day} className={`min-w-0 flex-1 text-center ${v.day === now ? "font-semibold text-cyan" : ""} ${i % 2 && v.day !== now ? "max-sm:invisible" : ""}`}>{v.day === now ? "Today" : Number(v.day.slice(8))}</span>)}
              </div>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted">
                {SEVERITY_ORDER.map((x) => <span key={x} className="inline-flex items-center gap-1.5"><SeverityIcon severity={x} size={13} />{SEV_WORD[x]}</span>)}
              </div>
            </div>
          </Card>

          <Card title="By source" flush action={sources24.length ? "last 24 h" : "last 14 days"}>
            {sideSources.length === 0 ? <Empty>Nothing in the last 14 days.</Empty> : (
              <div className="divide-y divide-line">
                {sideSources.slice(0, 7).map((x, i) => (
                  <Link key={x.source} href={href({ source: x.source })} className="flex min-h-11 items-center gap-3 px-4 py-2 transition-colors hover:bg-fill sm:px-5">
                    <SourceMark name={x.source} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[15px] text-ink">{x.source}</div>
                      <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-fill"><i className="block h-full rounded-full" style={{ width: `${(x.count / maxSource) * 100}%`, background: CHART_COLORS[i % CHART_COLORS.length] }} /></span>
                    </div>
                    <span className="w-8 shrink-0 text-right text-[15px] tabular-nums text-muted">{x.count}</span>
                  </Link>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      <div className="mb-6 grid gap-2.5">
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

      <div className={`grid items-start gap-7 ${showTasks ? "xl:grid-cols-[minmax(0,1fr)_320px] xl:gap-8" : ""}`}>
        <div className="grid min-w-0 gap-7">
          <div className="-mb-5 flex flex-wrap items-baseline justify-between gap-x-3 px-1">
            <h2 className="text-[20px] font-bold tracking-[-0.01em] text-ink">History</h2>
            <span className="text-[13px] text-muted">{src ?? "All sources"} · {s.business ?? "all businesses"}</span>
          </div>
          {list.length === 0 ? <Group><Empty>{all.length ? "Nothing matches these filters." : "All quiet."}</Empty></Group> : groupByDay(list, tz).map(([day, items]) => (
            <section key={day} className="min-w-0">
              <div className="mb-1.5 flex items-baseline justify-between gap-2 px-4">
                <h3 className="text-[13px] uppercase tracking-[0.02em] text-muted">{dayLabel(day)}</h3>
                <span className="text-[13px] tabular-nums text-muted">{items.length}</span>
              </div>
              <ul className={`overflow-hidden rounded-[14px] bg-panel ${ring} [&>li+li]:border-t [&>li+li]:border-line`}>
                {items.map((n) => (
                  <li key={n.id} className={`flex items-start gap-3 px-4 py-3 sm:px-5 ${n.severity === "critical" ? "bg-critical/[0.06]" : ""}`}>
                    <span className="pt-px"><SeverityIcon severity={n.severity} size={22} /></span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-3">
                        <div className="min-w-0 break-words text-[15px] leading-snug text-ink">
                          {n.url ? <a href={n.url} target="_blank" rel="noreferrer" className="hover:text-cyan">{n.title}</a> : n.title}
                        </div>
                        <span className="shrink-0 text-[13px] tabular-nums text-muted">{new Date(n.at).toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" })}</span>
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted">
                        <span className="font-semibold" style={{ color: SEV_TEXT[n.severity] }}>{SEV_WORD[n.severity]}</span>
                        <span className="inline-flex items-center gap-1.5"><SourceMark name={sourceName(n.source)} />{n.source}</span>
                        {n.business && !n.source.includes(n.business) && <BizLabel name={n.business} />}
                      </div>
                      {n.body && <div className="mt-0.5 line-clamp-2 break-words text-[13px] leading-snug text-muted">{n.body}</div>}
                    </div>
                    {n.url && <a href={n.url} target="_blank" rel="noreferrer" className="hidden shrink-0 items-center gap-0.5 self-center text-[15px] text-cyan hover:opacity-70 sm:inline-flex">Open<ArrowUpRight size={14} /></a>}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        {showTasks && (
          <aside className="min-w-0">
            <Group header="Still open" footer={`${openBad.length} critical or high in To-do`}>
              {openBad.length === 0 ? <Empty>Nothing critical or high is open ✓</Empty> : openBad.slice(0, 6).map((t) => (
                <Row key={t.id} icon={<SeverityIcon severity={t.severity} size={18} />} iconColor="transparent" label={t.title} sub={<><span style={{ color: SEV_TEXT[t.severity] }}>{SEV_WORD[t.severity]}</span>{t.business ? ` · ${t.business}` : ""}</>} value={<span className="text-[13px] tabular-nums">{timeAgo(t.createdAt).replace(" ago", "")}</span>} />
              ))}
              <Row href="/tasks" label={<span className="text-cyan">Open To-do</span>} />
            </Group>
          </aside>
        )}
      </div>

      <DeliveryLog rows={deliveries} everyone={everyone} timeZone={tz} />
    </>
  );
}
