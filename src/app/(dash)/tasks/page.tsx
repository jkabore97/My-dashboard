import { requireSection } from "@/lib/server/auth";
import Link from "next/link";
import type { CSSProperties } from "react";
import { getDashboard, getTasksByStatus, type TaskView } from "@/lib/server/dashboard";
import { SEVERITY_ORDER, type Severity } from "@/lib/types";
import { Card, Empty, PageHeader, SeverityIcon, businessColor, timeAgo } from "@/components/ui";
import { TaskRow } from "@/components/TaskRow";
import { AddTaskForm } from "@/components/AddTaskForm";
import { people as listPeople } from "@/lib/server/people";
import { listActivity } from "@/lib/server/store/tasks";
import { canSeeTask } from "@/lib/access";
import { Avatar, Chip, ChipRow, KpiStrip, SEV_COLOR, SEV_WORD } from "@/components/command/hud";
import { severityCounts } from "@/components/command/logic";

const ACTION: Record<string, string> = { done: "marked done", reopen: "reopened", snooze: "snoozed", business: "moved", assign: "assigned", delete: "deleted", create: "created" };

const BLURB = {
  critical: "Money, security or a site at risk. Handle today.",
  high: "Will hurt soon if ignored. Handle this week.",
  medium: "Real work, no fire. Schedule it.",
  low: "Housekeeping. Batch it when you have a slow hour.",
};

const VIEWS = { open: "Open", mine: "Assigned to me", snoozed: "Snoozed", done: "Done", activity: "Activity" } as const;
type View = keyof typeof VIEWS;

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ business?: string; view?: string }> }) {
  const user = await requireSection("tasks");
  const params = await searchParams;
  const view: View = params.view && Object.hasOwn(VIEWS, params.view) ? (params.view as View) : "open";
  const business = params.business;
  const d = await getDashboard();

  const [snoozed, done, team, log] = d.dbError
    ? [[], [], [], []]
    : await Promise.all([
        getTasksByStatus("snoozed").catch(() => [] as TaskView[]),
        getTasksByStatus("done").catch(() => [] as TaskView[]),
        listPeople().catch(() => []),
        listActivity({ limit: 300 }).catch(() => []),
      ]);
  const inBiz = (t: { business?: string | null }) => !business || (t.business ?? "Unassigned") === business;
  const mine = d.openTasks.filter((t) => t.assignee === user.email);
  const all: TaskView[] = view === "snoozed" ? snoozed : view === "done" ? done : view === "mine" ? mine : d.openTasks;
  const tasks = all.filter(inBiz);
  const businesses = (user.businesses ?? ([...new Set([...d.openTasks, ...d.repos, ...d.websites].map((t) => t.business).filter(Boolean))].sort() as string[]));
  // A teammate limited to some businesses only learns about people who share one of them, and only those businesses.
  const visibleTo = (p: (typeof team)[number]) => (user.businesses === null ? p.businesses : p.businesses === null ? user.businesses : p.businesses.filter((b) => user.businesses!.includes(b)));
  const people = team.length > 1 ? team.map((p) => ({ email: p.email, name: p.name, businesses: visibleTo(p) })).filter((p) => p.businesses === null || p.businesses.length > 0) : [];
  const names = Object.fromEntries(people.map((p) => [p.email, p.name]));
  const activity = log.filter((a) => canSeeTask(user, user.email, a) && (!business || a.business === business));

  const href = (next: { business?: string; view?: View }) => {
    const q = new URLSearchParams();
    const b = "business" in next ? next.business : business;
    const v = next.view ?? view;
    if (b) q.set("business", b);
    if (v !== "open") q.set("view", v);
    const s = q.toString();
    return s ? `/tasks?${s}` : "/tasks";
  };

  const open = d.openTasks.filter(inBiz);
  const counts = severityCounts(open);
  const openBusinesses = new Set(open.map((t) => t.business ?? "Unassigned")).size;
  const byBusiness = (b: string) => d.openTasks.filter((t) => (t.business ?? "Unassigned") === b).length;
  const viewCount: Partial<Record<View, number>> = { open: open.length, mine: mine.filter(inBiz).length, ...(d.dbError ? {} : { snoozed: snoozed.filter(inBiz).length, done: done.filter(inBiz).length }) };
  const kpiTone: Record<Severity, [string, string]> = { critical: ["#ff3d6e", "#ff7a9a"], high: ["#ff9f1c", "#ffc56b"], medium: ["#3fd0ff", "#a98bff"], low: ["#8fa6b8", "#a98bff"] };
  const KPI_HINT: Record<Severity, string> = { critical: "handle today", high: "this week", medium: "schedule it", low: "batch it" };

  // Side panels
  const load = people.length
    ? [...people.map((p) => ({ key: p.email, name: p.name, list: open.filter((t) => t.assignee === p.email) })), { key: "", name: "Unassigned", list: open.filter((t) => !t.assignee) }].filter((r) => r.list.length > 0 || r.key)
    : [];
  const maxLoad = Math.max(1, ...load.map((r) => r.list.length));
  const today24 = activity.filter((a) => Date.parse(a.at) > Date.now() - 86_400_000);
  const recent = (today24.length ? today24 : activity).slice(0, 6);
  const sleeping = snoozed.filter(inBiz).sort((a, b) => (a.snoozedUntil ?? "").localeCompare(b.snoozedUntil ?? "")).slice(0, 5);
  const withSide = view !== "activity" && (load.length > 0 || !d.dbError);

  return (
    <>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-x-3 gap-y-4">
        <div className="min-w-0 flex-1 [&>div]:mb-0">
          <PageHeader title="To-do" subtitle="Generated from every connected platform, plus your own tasks, ranked by how much each can hurt you." />
        </div>
        {!d.dbError && <AddTaskForm businesses={businesses} defaultBusiness={business ?? (user.businesses?.length === 1 ? user.businesses[0] : undefined)} people={people} />}
        <KpiStrip
          className="order-1 basis-full"
          items={[
            { label: "Open", value: open.length, hint: `across ${openBusinesses} business${openBusinesses === 1 ? "" : "es"}${business ? ` · ${business}` : ""}`, c1: "#3df5a0", c2: "#2ef2d0", bar: open.length ? 1 : 0 },
            ...SEVERITY_ORDER.map((s) => ({ label: SEV_WORD[s], value: counts[s], hint: KPI_HINT[s], c1: kpiTone[s][0], c2: kpiTone[s][1], bar: open.length ? counts[s] / open.length : 0 })),
          ]}
        />
      </div>

      <div className="mb-5 grid gap-2.5">
        <ChipRow label="View">
          {(Object.keys(VIEWS) as View[]).map((v) => <Chip key={v} href={href({ view: v })} active={view === v} count={viewCount[v]}>{VIEWS[v]}</Chip>)}
        </ChipRow>
        <ChipRow label="Business">
          <Chip href={href({ business: undefined })} active={!business} count={d.openTasks.length}>All businesses</Chip>
          {businesses.map((b) => <Chip key={b} href={href({ business: b })} active={business === b} count={byBusiness(b)} dot={businessColor(b)}>{b}</Chip>)}
        </ChipRow>
      </div>

      <div className={`grid items-start gap-4 lg:gap-[22px] ${withSide ? "xl:grid-cols-[minmax(0,1fr)_340px]" : ""}`}>
        <div className="grid min-w-0 gap-4 lg:gap-[22px]">
          {view === "activity" ? (
            <Card title="Activity" flush action={`${activity.length > 100 ? "latest 100" : activity.length} change${activity.length === 1 ? "" : "s"}`}>
              {activity.length === 0 ? <Empty>No task activity yet.</Empty> : <ActivityList items={activity.slice(0, 100)} names={names} />}
            </Card>
          ) : view === "open" ? (
            SEVERITY_ORDER.map((sev) => {
              const list = tasks.filter((t) => t.severity === sev);
              return (
                <section key={sev} className="hud-panel" style={{ "--a": SEV_COLOR[sev] } as CSSProperties}>
                  <header className="hud-head flex flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-5">
                    <h2 className="hud-title flex items-center gap-2.5 text-[13px]"><SeverityIcon severity={sev} size={16} />{SEV_WORD[sev]} <span className="font-mono tabular-nums">{list.length}</span></h2>
                    <span className="hidden text-[12.5px] text-muted sm:inline">{BLURB[sev]}</span>
                  </header>
                  {list.length ? <ul>{list.map((t) => <TaskRow key={t.id} task={t} businesses={businesses} people={people} names={names} me={user.email} />)}</ul> : <p className="px-5 py-4 text-sm text-muted">Nothing here.</p>}
                </section>
              );
            })
          ) : (
            <Card title={VIEWS[view]} flush action={`${tasks.length} task${tasks.length === 1 ? "" : "s"}`}>
              {tasks.length ? (
                <ul>{tasks.map((t) => <TaskRow key={t.id} task={t} businesses={businesses} people={people} names={names} me={user.email} badge />)}</ul>
              ) : (
                <Empty>{view === "done" ? "Nothing completed in the last 90 days." : view === "mine" ? "Nothing assigned to you." : "Nothing snoozed."}</Empty>
              )}
            </Card>
          )}
        </div>

        {withSide && (
          <aside className="grid min-w-0 gap-4 lg:gap-[22px]">
            {load.length > 0 && (
              <Card title="Team load" accent="pink" flush action="open tasks">
                <div className="py-2">
                  {load.map((r) => {
                    const c = severityCounts(r.list);
                    return (
                      <div key={r.key || "none"} className="grid grid-cols-[20px_minmax(0,90px)_minmax(0,1fr)_24px] items-center gap-2.5 px-4 py-2 text-[13px] sm:px-5">
                        {r.key ? <Avatar name={r.name} color={businessColor(r.name)} /> : <span className="inline-grid h-5 w-5 place-items-center rounded-full bg-line text-[10px] text-muted">?</span>}
                        <span className="truncate">{r.name}</span>
                        <div className="flex h-2 gap-[2px] bg-cyan/[0.08]" role="img" aria-label={SEVERITY_ORDER.map((s) => `${c[s]} ${s}`).join(", ")}>
                          {SEVERITY_ORDER.map((s) => (c[s] ? <i key={s} className="block h-full" style={{ width: `${(c[s] / maxLoad) * 100}%`, background: SEV_COLOR[s] }} title={`${c[s]} ${s}`} /> : null))}
                        </div>
                        <span className="text-right font-mono tabular-nums">{r.list.length}</span>
                      </div>
                    );
                  })}
                </div>
              </Card>
            )}
            {!d.dbError && (
              <Card title="Activity" accent="lime" flush action={today24.length ? "last 24 h" : "latest"}>
                {recent.length === 0 ? <p className="px-5 py-4 text-sm text-muted">No task activity yet.</p> : <ActivityList items={recent} names={names} />}
                <Link href={href({ view: "activity" })} className="hud-label block px-5 pb-4 pt-1 text-[12px] text-cyan hover:underline">Full activity log →</Link>
              </Card>
            )}
            {!d.dbError && sleeping.length > 0 && view !== "snoozed" && (
              <Card title="Snoozed" accent="violet" flush action={`${viewCount.snoozed} · wake up on their own`}>
                {sleeping.map((t) => (
                  <div key={t.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 border-b border-line/50 px-4 py-2.5 text-[13px] last:border-0 sm:px-5">
                    <div className="min-w-0">
                      <div className="break-words">{t.title}</div>
                      <div className="truncate text-xs text-muted">{[t.source, t.business, t.assignee ? `→ ${names[t.assignee] ?? t.assignee}` : null].filter(Boolean).join(" · ")}</div>
                    </div>
                    {t.snoozedUntil && <span className="font-mono text-[11.5px] tabular-nums text-violet">{new Date(t.snoozedUntil).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" })}</span>}
                  </div>
                ))}
                {(viewCount.snoozed ?? 0) > sleeping.length && <Link href={href({ view: "snoozed" })} className="hud-label block px-5 pb-4 pt-2 text-[12px] text-cyan hover:underline">All snoozed →</Link>}
              </Card>
            )}
          </aside>
        )}
      </div>
    </>
  );
}

function ActivityList({ items, names }: { items: Awaited<ReturnType<typeof listActivity>>; names: Record<string, string> }) {
  return (
    <ul>
      {items.map((a) => {
        const actor = names[a.actor] ?? a.actor;
        return (
          <li key={a.id} className="grid grid-cols-[20px_minmax(0,1fr)] gap-2.5 border-b border-line/50 px-4 py-2.5 text-[13px] leading-snug last:border-0 sm:px-5">
            <Avatar name={actor} color={businessColor(actor)} />
            <div className="min-w-0 break-words">
              <span className="font-medium">{actor}</span> {ACTION[a.action] ?? a.action}
              {a.action === "assign" ? <> to {a.detail?.assignee ? names[String(a.detail.assignee)] ?? String(a.detail.assignee) : "nobody"}</> : null}
              {a.action === "snooze" && a.detail?.preset ? <> for {String(a.detail.preset)}</> : null} <span className="text-[#a9bbc9]">“{a.taskTitle}”</span>
              <span className="mt-0.5 block text-[11.5px] text-muted">{timeAgo(a.at)}{a.business ? ` · ${a.business}` : ""}</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
