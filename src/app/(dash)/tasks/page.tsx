import { requireSection } from "@/lib/server/auth";
import Link from "next/link";
import type { ReactNode } from "react";
import { getDashboard, getTasksByStatus, type TaskView } from "@/lib/server/dashboard";
import { SEVERITY_ORDER, type Severity } from "@/lib/types";
import { Empty, PageHeader, SeverityIcon, SYS, businessColor, timeAgo } from "@/components/ui";
import { TaskRow } from "@/components/TaskRow";
import { AddTaskForm } from "@/components/AddTaskForm";
import { people as listPeople } from "@/lib/server/people";
import { listActivity } from "@/lib/server/store/tasks";
import { canSeeTask } from "@/lib/access";
import { Avatar, Chip, ChipRow, KpiStrip, SEV_COLOR, SEV_TEXT, SEV_WORD } from "@/components/command/hud";
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

/** A Reminders-style list: coloured title with the count on the right, rows in a rounded group, a muted note under it. */
function TaskList({ title, count, color, icon, footer, children }: { title: ReactNode; count?: ReactNode; color?: string; icon?: ReactNode; footer?: ReactNode; children: ReactNode }) {
  return (
    <section className="min-w-0">
      <div className="mb-2 flex items-baseline justify-between gap-3 px-1">
        <h2 className="flex min-w-0 items-center gap-2 text-[20px] font-bold tracking-[-0.01em]" style={{ color: color ?? "var(--color-ink)" }}>
          {icon && <span className="self-center">{icon}</span>}
          <span className="truncate">{title}</span>
        </h2>
        {count !== undefined && <span className="shrink-0 text-[20px] font-bold tabular-nums text-muted">{count}</span>}
      </div>
      <div className="overflow-hidden rounded-[14px] bg-panel shadow-[0_0_0_1px_var(--color-line)]">{children}</div>
      {footer && <p className="mt-1.5 px-4 text-[13px] leading-snug text-muted">{footer}</p>}
    </section>
  );
}

/** A small side group (Team load, Activity, Snoozed): grey header, rounded rows. */
function Side({ header, note, children }: { header: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section className="min-w-0">
      <div className="mb-1.5 flex items-baseline justify-between gap-2 px-4">
        <h3 className="text-[13px] uppercase tracking-[0.02em] text-muted">{header}</h3>
        {note && <span className="text-[13px] text-muted">{note}</span>}
      </div>
      <div className="overflow-hidden rounded-[14px] bg-panel shadow-[0_0_0_1px_var(--color-line)]">{children}</div>
    </section>
  );
}

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ business?: string; view?: string }> }) {
  const user = await requireSection("tasks");
  const params = await searchParams;
  const view: View = params.view && Object.hasOwn(VIEWS, params.view) ? (params.view as View) : "open";
  const business = params.business;
  const d = await getDashboard();
  // Lists read straight from the store follow the top-bar business filter like open tasks do.
  const focused = (list: TaskView[]) => (d.business ? list.filter((t) => t.business === d.business) : list);

  const [snoozed, done, team, log] = d.dbError
    ? [[], [], [], []]
    : await Promise.all([
        getTasksByStatus("snoozed").then(focused).catch(() => [] as TaskView[]),
        getTasksByStatus("done").then(focused).catch(() => [] as TaskView[]),
        listPeople().catch(() => []),
        listActivity({ limit: 300 }).then((l) => (d.business ? l.filter((a) => a.business === d.business) : l)).catch(() => []),
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
  // Numbers are only coloured when they mean trouble (critical / high with something in them).
  const kpiColor = (s: Severity) => ((s === "critical" || s === "high") && counts[s] ? SEV_COLOR[s] : SYS.gray);
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
          <PageHeader title="Tasks" subtitle="Generated from every connected platform, plus your own tasks, ranked by how much each can hurt you." />
        </div>
        {!d.dbError && <AddTaskForm businesses={businesses} defaultBusiness={business ?? (user.businesses?.length === 1 ? user.businesses[0] : undefined)} people={people} />}
        <KpiStrip
          className="order-1 basis-full"
          items={[
            { label: "Open", value: open.length, hint: `across ${openBusinesses} business${openBusinesses === 1 ? "" : "es"}${business ? ` · ${business}` : ""}`, c1: SYS.gray, bar: open.length ? 1 : 0 },
            ...SEVERITY_ORDER.map((s) => ({ label: SEV_WORD[s], value: counts[s], hint: KPI_HINT[s], c1: kpiColor(s), bar: open.length ? counts[s] / open.length : 0 })),
          ]}
        />
      </div>

      <div className="mb-6 grid gap-2.5">
        <ChipRow label="View">
          {(Object.keys(VIEWS) as View[]).map((v) => <Chip key={v} href={href({ view: v })} active={view === v} count={viewCount[v]}>{VIEWS[v]}</Chip>)}
        </ChipRow>
        <ChipRow label="Business">
          <Chip href={href({ business: undefined })} active={!business} count={d.openTasks.length}>All businesses</Chip>
          {businesses.map((b) => <Chip key={b} href={href({ business: b })} active={business === b} count={byBusiness(b)} dot={businessColor(b)}>{b}</Chip>)}
        </ChipRow>
      </div>

      <div className={`grid items-start gap-7 ${withSide ? "xl:grid-cols-[minmax(0,1fr)_320px] xl:gap-8" : ""}`}>
        <div className="grid min-w-0 gap-7">
          {view === "activity" ? (
            <TaskList title="Activity" count={activity.length > 100 ? "100+" : activity.length}>
              {activity.length === 0 ? <Empty>No task activity yet.</Empty> : <ActivityList items={activity.slice(0, 100)} names={names} />}
            </TaskList>
          ) : view === "open" ? (
            SEVERITY_ORDER.map((sev) => {
              const list = tasks.filter((t) => t.severity === sev);
              return (
                <TaskList key={sev} title={SEV_WORD[sev]} count={list.length} color={SEV_TEXT[sev]} icon={<SeverityIcon severity={sev} size={18} />} footer={BLURB[sev]}>
                  {list.length ? (
                    <ul className="divide-y divide-line [&>li]:border-line">{list.map((t) => <TaskRow key={t.id} task={t} businesses={businesses} people={people} names={names} me={user.email} />)}</ul>
                  ) : (
                    <p className="px-4 py-3 text-[15px] text-muted">Nothing here.</p>
                  )}
                </TaskList>
              );
            })
          ) : (
            <TaskList title={VIEWS[view]} count={tasks.length}>
              {tasks.length ? (
                <ul className="divide-y divide-line">{tasks.map((t) => <TaskRow key={t.id} task={t} businesses={businesses} people={people} names={names} me={user.email} badge />)}</ul>
              ) : (
                <Empty>{view === "done" ? "Nothing completed in the last 90 days." : view === "mine" ? "Nothing assigned to you ✓" : "Nothing snoozed."}</Empty>
              )}
            </TaskList>
          )}
        </div>

        {withSide && (
          <aside className="grid min-w-0 gap-7">
            {load.length > 0 && (
              <Side header="Team load" note="open tasks">
                <div className="divide-y divide-line">
                  {load.map((r) => {
                    const c = severityCounts(r.list);
                    return (
                      <div key={r.key || "none"} className="flex min-h-11 items-center gap-3 px-4 py-2.5">
                        {r.key ? <Avatar name={r.name} color={businessColor(r.name)} /> : <span className="inline-grid h-6 w-6 shrink-0 place-items-center rounded-full bg-fill-2 text-[11px] font-semibold text-muted">?</span>}
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[15px] text-ink">{r.name}</div>
                          <div className="mt-1 flex h-1.5 gap-[2px] overflow-hidden rounded-full bg-fill" role="img" aria-label={SEVERITY_ORDER.map((s) => `${c[s]} ${s}`).join(", ")}>
                            {SEVERITY_ORDER.map((s) => (c[s] ? <i key={s} className="block h-full first:rounded-l-full last:rounded-r-full" style={{ width: `${(c[s] / maxLoad) * 100}%`, background: SEV_COLOR[s] }} title={`${c[s]} ${s}`} /> : null))}
                          </div>
                        </div>
                        <span className="w-6 shrink-0 text-right text-[15px] tabular-nums text-muted">{r.list.length}</span>
                      </div>
                    );
                  })}
                </div>
              </Side>
            )}
            {!d.dbError && (
              <Side header="Activity" note={today24.length ? "last 24 h" : "latest"}>
                {recent.length === 0 ? <p className="px-4 py-3 text-[15px] text-muted">No task activity yet.</p> : <ActivityList items={recent} names={names} />}
                <Link href={href({ view: "activity" })} className="flex min-h-11 items-center border-t border-line px-4 text-[15px] text-cyan hover:bg-fill">Full activity log</Link>
              </Side>
            )}
            {!d.dbError && sleeping.length > 0 && view !== "snoozed" && (
              <Side header="Snoozed" note="wake up on their own">
                <div className="divide-y divide-line">
                  {sleeping.map((t) => (
                    <div key={t.id} className="flex min-h-11 items-start gap-3 px-4 py-2.5">
                      <span className="mt-[3px] block h-[18px] w-[18px] shrink-0 rounded-full border-[1.5px] border-dashed" style={{ borderColor: SEV_COLOR[t.severity] }} aria-hidden />
                      <div className="min-w-0 flex-1">
                        <div className="break-words text-[15px] leading-snug text-ink">{t.title}</div>
                        <div className="truncate text-[13px] text-muted">{[t.source, t.business, t.assignee ? `→ ${names[t.assignee] ?? t.assignee}` : null].filter(Boolean).join(" · ")}</div>
                      </div>
                      {t.snoozedUntil && <span className="shrink-0 pt-0.5 text-[13px] tabular-nums text-muted">{new Date(t.snoozedUntil).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" })}</span>}
                    </div>
                  ))}
                </div>
                {(viewCount.snoozed ?? 0) > sleeping.length && <Link href={href({ view: "snoozed" })} className="flex min-h-11 items-center border-t border-line px-4 text-[15px] text-cyan hover:bg-fill">All {viewCount.snoozed} snoozed</Link>}
              </Side>
            )}
          </aside>
        )}
      </div>
    </>
  );
}

function ActivityList({ items, names }: { items: Awaited<ReturnType<typeof listActivity>>; names: Record<string, string> }) {
  return (
    <ul className="divide-y divide-line">
      {items.map((a) => {
        const actor = names[a.actor] ?? a.actor;
        return (
          <li key={a.id} className="flex gap-3 px-4 py-2.5 text-[15px] leading-snug">
            <Avatar name={actor} color={businessColor(actor)} />
            <div className="min-w-0 flex-1 break-words text-ink">
              <span className="font-semibold">{actor}</span> {ACTION[a.action] ?? a.action}
              {a.action === "assign" ? <> to {a.detail?.assignee ? names[String(a.detail.assignee)] ?? String(a.detail.assignee) : "nobody"}</> : null}
              {a.action === "snooze" && a.detail?.preset ? <> for {String(a.detail.preset)}</> : null} <span className="text-muted">“{a.taskTitle}”</span>
              <span className="mt-0.5 block text-[13px] text-muted">{timeAgo(a.at)}{a.business ? ` · ${a.business}` : ""}</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
