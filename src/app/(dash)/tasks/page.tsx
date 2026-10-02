import { requireSection } from "@/lib/server/auth";
import Link from "next/link";
import { getDashboard, getTasksByStatus, type TaskView } from "@/lib/server/dashboard";
import { SEVERITY_ORDER } from "@/lib/types";
import { Card, Empty, PageHeader, SeverityBadge } from "@/components/ui";
import { TaskRow } from "@/components/TaskRow";
import { AddTaskForm } from "@/components/AddTaskForm";
import { people as listPeople } from "@/lib/server/people";
import { listActivity } from "@/lib/server/store/tasks";
import { canSeeTask } from "@/lib/access";
import { timeAgo } from "@/components/ui";

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

  let all: TaskView[] = d.openTasks;
  if ((view === "snoozed" || view === "done") && !d.dbError) all = await getTasksByStatus(view);
  if (view === "mine") all = d.openTasks.filter((t) => t.assignee === user.email);
  const tasks = business ? all.filter((t) => (t.business ?? "Unassigned") === business) : all;
  const businesses = (user.businesses ?? ([...new Set([...d.openTasks, ...d.repos, ...d.websites].map((t) => t.business).filter(Boolean))].sort() as string[]));
  const team = d.dbError ? [] : await listPeople().catch(() => []);
  // A teammate limited to some businesses only learns about people who share one of them, and only those businesses.
  const visibleTo = (p: (typeof team)[number]) => (user.businesses === null ? p.businesses : p.businesses === null ? user.businesses : p.businesses.filter((b) => user.businesses!.includes(b)));
  const people = team.length > 1 ? team.map((p) => ({ email: p.email, name: p.name, businesses: visibleTo(p) })).filter((p) => p.businesses === null || p.businesses.length > 0) : [];
  const names = Object.fromEntries(people.map((p) => [p.email, p.name]));
  const activity = view === "activity" && !d.dbError ? (await listActivity({ limit: 300 })).filter((a) => canSeeTask(user, user.email, a) && (!business || a.business === business)).slice(0, 100) : [];

  const href = (next: { business?: string; view?: View }) => {
    const q = new URLSearchParams();
    const b = "business" in next ? next.business : business;
    const v = next.view ?? view;
    if (b) q.set("business", b);
    if (v !== "open") q.set("view", v);
    const s = q.toString();
    return s ? `/tasks?${s}` : "/tasks";
  };
  const chip = (label: string, to: string, active: boolean) => (
    <Link key={label} href={to} className={`rounded-full border px-3 py-1 text-xs ${active ? "border-accent bg-accent/15 text-accent" : "border-line text-muted hover:text-ink"}`}>{label}</Link>
  );

  return (
    <>
      <PageHeader title="To-do" subtitle="Generated from every connected platform, plus your own tasks, ranked by how much each can hurt you.">
        {!d.dbError && <AddTaskForm businesses={businesses} defaultBusiness={business ?? (user.businesses?.length === 1 ? user.businesses[0] : undefined)} people={people} />}
      </PageHeader>

      <div className="mb-3 flex flex-wrap gap-2">
        {(Object.keys(VIEWS) as View[]).map((v) => chip(VIEWS[v], href({ view: v }), view === v))}
      </div>
      <div className="mb-6 flex flex-wrap gap-2">
        {chip("All businesses", href({ business: undefined }), !business)}
        {businesses.map((b) => chip(b, href({ business: b }), business === b))}
      </div>

      {view === "activity" ? (
        <Card>
          {activity.length === 0 ? <Empty>No task activity yet.</Empty> : (
            <ul className="-my-2 divide-y divide-line text-sm">
              {activity.map((a) => (
                <li key={a.id} className="py-2.5">
                  <span className="font-medium">{names[a.actor] ?? a.actor}</span> {ACTION[a.action] ?? a.action}
                  {a.action === "assign" ? <> to {a.detail?.assignee ? names[String(a.detail.assignee)] ?? String(a.detail.assignee) : "nobody"}</> : null}
                  {a.action === "snooze" && a.detail?.preset ? <> for {String(a.detail.preset)}</> : null} <span className="text-muted">“{a.taskTitle}”</span>
                  <span className="block text-xs text-muted">{timeAgo(a.at)}{a.business ? ` · ${a.business}` : ""}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : view === "open" ? (
        <div className="grid gap-4">
          {SEVERITY_ORDER.map((sev) => {
            const list = tasks.filter((t) => t.severity === sev);
            return (
              <Card key={sev} title={<span className="flex items-center gap-2"><SeverityBadge severity={sev} /> <span className="text-muted">{list.length}</span></span>} action={<span className="hidden text-xs text-muted sm:inline">{BLURB[sev]}</span>}>
                {list.length ? <ul className="-my-2 divide-y divide-line">{list.map((t) => <TaskRow key={t.id} task={t} businesses={businesses} people={people} names={names} />)}</ul> : <Empty>Nothing here.</Empty>}
              </Card>
            );
          })}
        </div>
      ) : (
        <Card>
          {tasks.length ? (
            <ul className="-my-2 divide-y divide-line">{tasks.map((t) => <TaskRow key={t.id} task={t} businesses={businesses} people={people} names={names} />)}</ul>
          ) : (
            <Empty>{view === "done" ? "Nothing completed in the last 90 days." : view === "mine" ? "Nothing assigned to you." : "Nothing snoozed."}</Empty>
          )}
        </Card>
      )}
    </>
  );
}
