import { requireSection } from "@/lib/server/auth";
import { getDashboard } from "@/lib/server/dashboard";
import { addDays, daysBetween, formatDate, relativeDays, today } from "@/lib/dates";
import { deadlineSeverity } from "@/lib/risk";
import type { Severity } from "@/lib/types";
import { BizLabel, Card, Empty, PageHeader, SeverityBadge } from "@/components/ui";
import { DeadlineForm, DeadlineRow, ReopenDeadline } from "@/components/records";
import { FilterChip, Metrics } from "@/components/treasury/ui";
import { DeadlineTimeline } from "@/components/treasury/DeadlineTimeline";

const CATEGORY: Record<string, string> = { tax: "Tax", filing: "Filing", license: "License", insurance: "Insurance", contract: "Contract", other: "Other" };
const CAT_COLOR: Record<string, string> = { tax: "#ffd84d", filing: "#3fd0ff", license: "#2ef2d0", insurance: "#a98bff", contract: "#ff5fd7", other: "#c6f432" };
const SEV_COLOR: Record<Severity, string> = { critical: "#ff3d6e", high: "#ff9f1c", medium: "#3fd0ff", low: "#8fa6b8" };
const REPEAT: Record<string, string> = { none: "", monthly: "monthly", quarterly: "quarterly", yearly: "yearly" };
const short = (date: string) => formatDate(date).replace(/, \d{4}$/, "");

export default async function DeadlinesPage({ searchParams }: { searchParams: Promise<{ cat?: string }> }) {
  await requireSection("deadlines");
  const sp = await searchParams;
  const cat = sp.cat && sp.cat in CATEGORY ? sp.cat : null;
  const d = await getDashboard();
  const now = today();
  const allOpen = d.records.deadlines.filter((x) => !x.completedOn).sort((a, b) => a.dueOn.localeCompare(b.dueOn));
  const open = cat ? allOpen.filter((x) => x.category === cat) : allOpen;
  const doneAll = d.records.deadlines.filter((x) => x.completedOn).sort((a, b) => b.completedOn!.localeCompare(a.completedOn!));
  const done = doneAll.slice(0, 20);
  const done90 = doneAll.filter((x) => x.completedOn! >= addDays(now, -90));
  const businesses = [...new Set([...d.records.deadlines.map((x) => x.business), ...d.openTasks.map((t) => t.business)].filter(Boolean))].sort() as string[];
  const days = (x: { dueOn: string }) => daysBetween(now, x.dueOn);
  const overdue = allOpen.filter((x) => days(x) < 0);
  const week = allOpen.filter((x) => days(x) >= 0 && days(x) <= 7);
  const month = allOpen.filter((x) => days(x) >= 0 && days(x) <= 30);
  const repeating = allOpen.filter((x) => x.recurrence !== "none").length;
  const lateDone = done90.filter((x) => x.completedOn! > x.dueOn).length;
  const sevOf = (x: { dueOn: string; remindDays: number }) => deadlineSeverity(days(x), x.remindDays);
  const pins = allOpen.filter((x) => days(x) <= 100).slice(0, 8).map((x) => {
    const sev = sevOf(x);
    return { id: x.id, date: x.dueOn, label: x.title, color: sev ? SEV_COLOR[sev] : CAT_COLOR[x.category] };
  });

  return (
    <>
      <PageHeader mode={d.modes.deadlines === "live" ? undefined : d.modes.deadlines} title="Deadlines" subtitle="Taxes, filings, licenses, insurance and contract renewals. They join your to-do list as they get close; repeating ones roll forward when you finish them." />
      <div className="-mt-2 mb-5 flex flex-wrap items-center justify-end gap-2">
        <FilterChip href="/deadlines" on={!cat}>All</FilterChip>
        {Object.entries(CATEGORY).map(([k, v]) => <FilterChip key={k} href={`/deadlines?cat=${k}`} on={cat === k}>{v}</FilterChip>)}
        <DeadlineForm businesses={businesses} />
      </div>

      <Card flush title="Status" action={`${allOpen.length} open · ${repeating} repeating`}>
        <Metrics
          items={[
            { label: "Overdue", value: overdue.length, tone: overdue.length ? "critical" : "ok", hint: overdue.length ? <span className="text-critical">{overdue[0].title} · {-days(overdue[0])} day{days(overdue[0]) === -1 ? "" : "s"} late{overdue.length > 1 ? ` · +${overdue.length - 1} more` : ""}</span> : "nothing late" },
            { label: "Next 7 days", value: week.length, tone: week.length ? "high" : "ink", hint: week.length ? `${week[0].title} · ${short(week[0].dueOn)}` : "nothing this week" },
            { label: "Next 30 days", value: month.length, tone: "cyan", hint: month.length ? `next: ${short(month[0].dueOn)}` : "nothing this month" },
            { label: "Done · 90 days", value: done90.length, tone: "emerald", hint: done90.length ? (lateDone ? `${lateDone} finished after the due date` : "all on time") : "none yet" },
          ]}
        />
        {pins.length > 0 && <DeadlineTimeline today={now} pins={pins} />}
      </Card>

      <Card flush accent="pink" className="mt-5" title={cat ? `Upcoming · ${CATEGORY[cat]}` : "Upcoming"} action="sorted by due date">
        {open.length === 0 ? <Empty>{cat ? `No open ${CATEGORY[cat].toLowerCase()} deadlines.` : "No upcoming deadlines. Add your tax dates, annual filings and renewals so nothing sneaks up on you."}</Empty> : (
          <div>
            {open.map((x) => {
              const n = days(x);
              const sev = sevOf(x);
              const c = sev ? SEV_COLOR[sev] : undefined;
              return (
                <DeadlineRow
                  key={x.id}
                  businesses={businesses}
                  recurring={x.recurrence !== "none"}
                  className="grid grid-cols-[78px_minmax(0,1fr)] items-center gap-x-3 gap-y-2 border-b border-line/50 px-4 py-3.5 sm:grid-cols-[96px_minmax(0,1fr)_auto] sm:gap-x-4 sm:px-5"
                  d={{ id: x.id, title: x.title, category: x.category, dueOn: x.dueOn, recurrence: x.recurrence, remindDays: x.remindDays, business: x.business, url: x.url, notes: x.notes }}
                >
                  <div className="self-start border-l-2 pl-3" style={{ borderColor: c ?? "var(--color-line)" }}>
                    <div className="font-display text-[15px] font-semibold" style={{ color: c ?? "#eaf7ff" }}>{short(x.dueOn)}</div>
                    <div className="text-xs text-muted">{relativeDays(n)}</div>
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-[15px] font-medium">{sev && <SeverityBadge severity={sev} />}{x.url ? <a href={x.url} target="_blank" rel="noreferrer" className="hover:text-cyan">{x.title}</a> : x.title}</div>
                    <div className="mt-1 text-xs text-muted">
                      <span className="hud-label text-[11px]" style={{ color: CAT_COLOR[x.category] }}>{CATEGORY[x.category]}</span>
                      {x.business && <> · <BizLabel name={x.business} /></>}
                      {[REPEAT[x.recurrence] && `repeats ${REPEAT[x.recurrence]}`, `reminds ${x.remindDays}d before`, x.notes].filter(Boolean).map((t, i) => <span key={i}> · {t}</span>)}
                    </div>
                  </div>
                </DeadlineRow>
              );
            })}
          </div>
        )}
        {done.length > 0 && (
          <details className="group border-t border-line">
            <summary className="hud-label flex min-h-11 cursor-pointer items-center px-4 text-xs text-cyan sm:px-5"><span className="mr-2 inline-block transition-transform group-open:rotate-90">▸</span>Completed ({done.length})</summary>
            <ul>
              {done.map((x) => (
                <li key={x.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-line/50 px-4 py-2 text-[13px] text-muted sm:px-5">
                  <span><s className="text-[#9fb3c3]">{x.title}{x.business ? ` · ${x.business}` : ""}</s> · done {short(x.completedOn!)}</span>
                  <ReopenDeadline id={x.id} />
                </li>
              ))}
            </ul>
          </details>
        )}
      </Card>

      <Card accent="violet" className="mt-5" title="By category" action="open deadlines">
        <div className="grid grid-cols-3 gap-2 lg:grid-cols-6">
          {Object.entries(CATEGORY).map(([k, v]) => {
            const n = allOpen.filter((x) => x.category === k).length;
            return (
              <a key={k} href={`/deadlines?cat=${k}`} className="block border px-3 py-2.5 hover:brightness-125" style={{ borderColor: `color-mix(in srgb, ${CAT_COLOR[k]} 35%, transparent)`, background: `color-mix(in srgb, ${CAT_COLOR[k]} 8%, transparent)` }}>
                <b className="block font-display text-xl tabular-nums" style={{ color: CAT_COLOR[k] }}>{n}</b>
                <span className="hud-label text-[11px] text-muted">{v}</span>
              </a>
            );
          })}
        </div>
      </Card>
    </>
  );
}
