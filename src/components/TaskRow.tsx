import { ArrowUpRight } from "lucide-react";
import type { TaskView } from "@/lib/server/dashboard";
import { BizLabel, SeverityBadge, SeverityIcon, businessColor, timeAgo } from "./ui";
import { TaskActions } from "./TaskActions";
import { FixButton } from "./FixButton";
import { Avatar } from "./command/hud";

export interface Assignable {
  email: string;
  name: string;
  /** null = every business */
  businesses: string[] | null;
}

const mini = "border px-1.5 font-display text-[10.5px] uppercase leading-[16px] tracking-[0.12em]";

/**
 * One task: severity shape (the word is in the section header, and in the
 * icon's label), title, where it came from, who has it, and what to do.
 */
export function TaskRow({ task: t, businesses = [], compact = false, people = [], names, me, badge = false }: { task: TaskView; businesses?: string[]; compact?: boolean; people?: Assignable[]; names?: Record<string, string>; me?: string; /** Show the severity word too (lists not grouped by severity). */ badge?: boolean }) {
  const external = !!t.url && /^https?:/.test(t.url);
  const who = t.assignee ? (names?.[t.assignee] ?? t.assignee) : null;
  const done = t.status === "done";
  return (
    <li className="grid grid-cols-[28px_minmax(0,1fr)] items-start gap-x-3 gap-y-2.5 border-b border-line/50 px-4 py-3.5 last:border-0 sm:grid-cols-[34px_minmax(0,1fr)_auto] sm:gap-x-4 sm:px-5">
      <span className="mt-0.5" title={t.severity} aria-label={`${t.severity} severity`}><SeverityIcon severity={t.severity} size={26} /></span>
      <div className="min-w-0">
        <div className={`break-words text-[14.5px] font-medium leading-snug ${done ? "text-muted line-through" : ""}`}>
          {t.url ? (
            <a href={t.url} target={external ? "_blank" : undefined} rel="noreferrer" className="hover:text-cyan">
              {t.title}
              {external && <ArrowUpRight size={12} className="ml-1 inline align-baseline text-muted" />}
            </a>
          ) : (
            t.title
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12.5px] text-muted">
          {badge && <SeverityBadge severity={t.severity} />}
          <span className="text-[#b7c7d4]">{t.source}</span>
          {t.business && !t.source.includes(t.business) && <BizLabel name={t.business} />}
          {who ? (
            <span className="inline-flex items-center gap-1.5 text-[#c5d3de]">
              → <Avatar name={who} color={businessColor(who)} />{who}
              {me && t.assignee === me && <span className={`${mini} border-cyan/40 text-cyan`}>You</span>}
            </span>
          ) : null}
          <span className="tabular-nums">{timeAgo(t.createdAt)}</span>
          {t.origin === "manual" && <span className={`${mini} border-violet/45 text-violet`}>Manual</span>}
          {t.origin === "demo" && <span className={`${mini} border-line text-muted`}>Demo</span>}
          {t.status === "snoozed" && t.snoozedUntil && <span className="text-violet">snoozed until {new Date(t.snoozedUntil).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" })}</span>}
        </div>
        {t.detail && <div className={`mt-1 text-[12.5px] text-[#a9bbc9] ${compact ? "truncate" : "break-words"}`}>{t.detail}</div>}
        {!compact && t.actionable && t.fix && <div className="mt-2.5"><FixButton taskId={t.id} label={t.fix} title={t.title} /></div>}
      </div>
      {!compact && t.actionable && (
        <div className="col-start-2 sm:col-start-3">
          <TaskActions id={t.id} status={t.status} manual={t.origin === "manual"} business={t.business} businesses={businesses} assignee={t.assignee ?? null} people={people.filter((p) => p.businesses === null || (!!t.business && p.businesses.includes(t.business)))} />
        </div>
      )}
    </li>
  );
}
