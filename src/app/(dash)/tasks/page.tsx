import Link from "next/link";
import { getDashboard, getTasksByStatus, type TaskView } from "@/lib/server/dashboard";
import { SEVERITY_ORDER } from "@/lib/types";
import { Card, Empty, PageHeader, SeverityBadge } from "@/components/ui";
import { TaskRow } from "@/components/TaskRow";
import { AddTaskForm } from "@/components/AddTaskForm";

const BLURB = {
  critical: "Money, security or a site at risk. Handle today.",
  high: "Will hurt soon if ignored. Handle this week.",
  medium: "Real work, no fire. Schedule it.",
  low: "Housekeeping. Batch it when you have a slow hour.",
};

const VIEWS = { open: "Open", snoozed: "Snoozed", done: "Done" } as const;
type View = keyof typeof VIEWS;

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ business?: string; view?: string }> }) {
  const params = await searchParams;
  const view: View = params.view === "snoozed" || params.view === "done" ? params.view : "open";
  const business = params.business;
  const d = await getDashboard();

  let all: TaskView[] = d.openTasks;
  if (view !== "open" && !d.dbError) all = await getTasksByStatus(view);
  const tasks = business ? all.filter((t) => (t.business ?? "Unassigned") === business) : all;
  const businesses = [...new Set([...d.openTasks, ...d.repos, ...d.websites].map((t) => t.business).filter(Boolean))].sort() as string[];

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
        {!d.dbError && <AddTaskForm businesses={businesses} defaultBusiness={business} />}
      </PageHeader>

      <div className="mb-3 flex flex-wrap gap-2">
        {(Object.keys(VIEWS) as View[]).map((v) => chip(VIEWS[v], href({ view: v }), view === v))}
      </div>
      <div className="mb-6 flex flex-wrap gap-2">
        {chip("All businesses", href({ business: undefined }), !business)}
        {businesses.map((b) => chip(b, href({ business: b }), business === b))}
      </div>

      {view === "open" ? (
        <div className="grid gap-4">
          {SEVERITY_ORDER.map((sev) => {
            const list = tasks.filter((t) => t.severity === sev);
            return (
              <Card key={sev} title={<span className="flex items-center gap-2"><SeverityBadge severity={sev} /> <span className="text-muted">{list.length}</span></span>} action={<span className="hidden text-xs text-muted sm:inline">{BLURB[sev]}</span>}>
                {list.length ? <ul className="-my-2 divide-y divide-line">{list.map((t) => <TaskRow key={t.id} task={t} businesses={businesses} />)}</ul> : <Empty>Nothing here.</Empty>}
              </Card>
            );
          })}
        </div>
      ) : (
        <Card>
          {tasks.length ? (
            <ul className="-my-2 divide-y divide-line">{tasks.map((t) => <TaskRow key={t.id} task={t} businesses={businesses} />)}</ul>
          ) : (
            <Empty>{view === "done" ? "Nothing completed in the last 90 days." : "Nothing snoozed."}</Empty>
          )}
        </Card>
      )}
    </>
  );
}
