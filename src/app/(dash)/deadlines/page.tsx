import { requireSection } from "@/lib/server/auth";
import { getDashboard } from "@/lib/server/dashboard";
import { daysBetween, formatDate, relativeDays, today } from "@/lib/dates";
import { deadlineSeverity } from "@/lib/risk";
import { Card, Empty, PageHeader, SeverityBadge } from "@/components/ui";
import { DeadlineForm, DeadlineRowActions, ReopenDeadline } from "@/components/records";

const CATEGORY: Record<string, string> = { tax: "Tax", filing: "Filing", license: "License", insurance: "Insurance", contract: "Contract", other: "Other" };
const REPEAT: Record<string, string> = { none: "", monthly: "monthly", quarterly: "quarterly", yearly: "yearly" };

export default async function DeadlinesPage() {
  await requireSection("deadlines");
  const d = await getDashboard();
  const now = today();
  const open = d.records.deadlines.filter((x) => !x.completedOn);
  const done = d.records.deadlines.filter((x) => x.completedOn).slice(0, 20);
  const businesses = [...new Set([...d.records.deadlines.map((x) => x.business), ...d.openTasks.map((t) => t.business)].filter(Boolean))].sort() as string[];

  return (
    <>
      <PageHeader mode={d.modes.deadlines === "live" ? undefined : d.modes.deadlines} title="Deadlines" subtitle="Taxes, filings, licenses, insurance and contract renewals. They join your to-do list as they get close; repeating ones roll forward when you finish them.">
        <DeadlineForm businesses={businesses} />
      </PageHeader>
      <Card>
        {open.length === 0 ? <Empty>No upcoming deadlines. Add your tax dates, annual filings and renewals so nothing sneaks up on you.</Empty> : (
          <ul className="-my-2 divide-y divide-line">
            {open.map((x) => {
              const days = daysBetween(now, x.dueOn);
              const sev = deadlineSeverity(days, x.remindDays);
              return (
                <li key={x.id} className="flex flex-wrap items-start gap-x-3 gap-y-2 py-3">
                  <div className="w-24 shrink-0 text-sm">
                    <div className={days < 0 ? "text-critical" : days <= 3 ? "text-high" : ""}>{formatDate(x.dueOn)}</div>
                    <div className="text-xs text-muted">{relativeDays(days)}</div>
                  </div>
                  <div className="min-w-0 flex-1 basis-48">
                    <div className="flex items-center gap-2 text-sm">{sev && <SeverityBadge severity={sev} />}{x.url ? <a href={x.url} target="_blank" rel="noreferrer" className="hover:text-accent">{x.title}</a> : x.title}</div>
                    <div className="text-xs text-muted">{[CATEGORY[x.category], x.business, REPEAT[x.recurrence] && `repeats ${REPEAT[x.recurrence]}`, `reminds ${x.remindDays}d before`, x.notes].filter(Boolean).join(" · ")}</div>
                  </div>
                  <DeadlineRowActions businesses={businesses} recurring={x.recurrence !== "none"} d={{ id: x.id, title: x.title, category: x.category, dueOn: x.dueOn, recurrence: x.recurrence, remindDays: x.remindDays, business: x.business, url: x.url, notes: x.notes }} />
                </li>
              );
            })}
          </ul>
        )}
        {done.length > 0 && (
          <details className="mt-4 border-t border-line pt-3">
            <summary className="cursor-pointer text-xs text-accent">Completed ({done.length})</summary>
            <ul className="mt-2 space-y-1 text-sm text-muted">{done.map((x) => <li key={x.id} className="flex flex-wrap items-center justify-between gap-2"><span>{x.title} · done {formatDate(x.completedOn!)}</span><ReopenDeadline id={x.id} /></li>)}</ul>
          </details>
        )}
      </Card>
    </>
  );
}
