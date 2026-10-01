import Link from "next/link";
import { getSnapshot } from "@/lib/aggregate";
import { SEVERITY_ORDER } from "@/lib/types";
import { Card, Empty, PageHeader, SeverityBadge } from "@/components/ui";
import { TaskRow } from "@/components/TaskRow";

const BLURB = {
  critical: "Money, security or a site at risk. Handle today.",
  high: "Will hurt soon if ignored. Handle this week.",
  medium: "Real work, no fire. Schedule it.",
  low: "Housekeeping. Batch it when you have a slow hour.",
};

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ business?: string }> }) {
  const { business } = await searchParams;
  const s = await getSnapshot();
  const businesses = [...new Set(s.tasks.map((t) => t.business).filter(Boolean))] as string[];
  const tasks = business ? s.tasks.filter((t) => t.business === business) : s.tasks;

  const chip = (label: string, href: string, active: boolean) => (
    <Link key={label} href={href} className={`rounded-full border px-3 py-1 text-xs ${active ? "border-accent bg-accent/15 text-accent" : "border-line text-muted hover:text-ink"}`}>{label}</Link>
  );

  return (
    <>
      <PageHeader title="To-do" subtitle="Generated from every connected platform and ranked by how much it can hurt you." />
      <div className="mb-6 flex flex-wrap gap-2">
        {chip("All businesses", "/tasks", !business)}
        {businesses.sort().map((b) => chip(b, `/tasks?business=${encodeURIComponent(b)}`, business === b))}
      </div>
      <div className="grid gap-4">
        {SEVERITY_ORDER.map((sev) => {
          const list = tasks.filter((t) => t.severity === sev);
          return (
            <Card key={sev} title={<span className="flex items-center gap-2"><SeverityBadge severity={sev} /> <span className="text-muted">{list.length}</span></span>} action={<span className="hidden text-xs text-muted sm:inline">{BLURB[sev]}</span>}>
              {list.length ? <ul className="-my-2 divide-y divide-line">{list.map((t) => <TaskRow key={t.id} task={t} />)}</ul> : <Empty>Nothing here.</Empty>}
            </Card>
          );
        })}
      </div>
    </>
  );
}
