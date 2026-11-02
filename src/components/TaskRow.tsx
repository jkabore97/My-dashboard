import { ArrowUpRight } from "lucide-react";
import type { TaskView } from "@/lib/server/dashboard";
import { BizLabel, SeverityBadge, SeverityIcon, Tag, businessColor, SYS, timeAgo } from "./ui";
import { TaskActions, TaskCheck } from "./TaskActions";
import { FixButton } from "./FixButton";
import { Avatar } from "./command/hud";

export interface Assignable {
  email: string;
  name: string;
  /** null = every business */
  businesses: string[] | null;
}

/**
 * One task, Reminders style: a round check (coloured by severity; the word is in
 * the section header and the check's label), the title, a muted line saying
 * where it came from and who has it, and small tap actions.
 */
export function TaskRow({ task: t, businesses = [], compact = false, people = [], names, me, badge = false }: { task: TaskView; businesses?: string[]; compact?: boolean; people?: Assignable[]; names?: Record<string, string>; me?: string; /** Show the severity word too (lists not grouped by severity). */ badge?: boolean }) {
  const external = !!t.url && /^https?:/.test(t.url);
  const who = t.assignee ? (names?.[t.assignee] ?? t.assignee) : null;
  const done = t.status === "done";
  return (
    <li className="flex items-start gap-3 py-3 pl-4 pr-4 sm:pr-5">
      <span className="pt-px">
        {t.actionable ? <TaskCheck id={t.id} status={t.status} severity={t.severity} title={t.title} /> : <span title={t.severity} aria-label={`${t.severity} severity`} className="block"><SeverityIcon severity={t.severity} size={22} /></span>}
      </span>
      <div className="grid min-w-0 flex-1 gap-y-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-x-4">
        <div className="min-w-0">
          <div className={`break-words text-[15px] leading-snug ${done ? "text-muted line-through" : "text-ink"}`}>
            {t.url ? (
              <a href={t.url} target={external ? "_blank" : undefined} rel="noreferrer" className="hover:text-cyan">
                {t.title}
                {external && <ArrowUpRight size={13} className="ml-1 inline align-baseline text-muted" />}
              </a>
            ) : (
              t.title
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] leading-snug text-muted">
            {badge && <SeverityBadge severity={t.severity} />}
            <span>{t.source}</span>
            {t.business && !t.source.includes(t.business) && <BizLabel name={t.business} />}
            {who ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="scale-[0.85]"><Avatar name={who} color={businessColor(who)} /></span>{who}
                {me && t.assignee === me && <Tag color={SYS.blue}>You</Tag>}
              </span>
            ) : null}
            <span className="tabular-nums">{timeAgo(t.createdAt)}</span>
            {t.origin === "manual" && t.source !== "Manual" && <Tag color={SYS.indigo}>Manual</Tag>}
            {t.privateTo && <Tag color={SYS.blue} title="From your own mailbox: only you see it">Personal</Tag>}
            {t.origin === "demo" && <Tag>Sample</Tag>}
            {t.status === "snoozed" && t.snoozedUntil && <span className="text-violet">Snoozed until {new Date(t.snoozedUntil).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" })}</span>}
          </div>
          {t.detail && <div className={`mt-1 text-[13px] leading-snug text-muted ${compact ? "truncate" : "break-words"}`}>{t.detail}</div>}
          {!compact && t.actionable && t.fix && <div className="mt-2"><FixButton taskId={t.id} label={t.fix} title={t.title} /></div>}
        </div>
        {!compact && t.actionable && (
          <div className="sm:pt-0.5">
            <TaskActions id={t.id} status={t.status} manual={t.origin === "manual"} personal={!!t.privateTo} business={t.business} businesses={businesses} assignee={t.assignee ?? null} people={t.privateTo ? [] : people.filter((p) => p.businesses === null || (!!t.business && p.businesses.includes(t.business)))} />
          </div>
        )}
      </div>
    </li>
  );
}
