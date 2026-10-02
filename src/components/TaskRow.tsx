import { ExternalLink } from "lucide-react";
import type { TaskView } from "@/lib/server/dashboard";
import { SeverityBadge, timeAgo } from "./ui";
import { TaskActions } from "./TaskActions";
import { FixButton } from "./FixButton";

export interface Assignable {
  email: string;
  name: string;
  /** null = every business */
  businesses: string[] | null;
}

export function TaskRow({ task: t, businesses = [], compact = false, people = [], names }: { task: TaskView; businesses?: string[]; compact?: boolean; people?: Assignable[]; names?: Record<string, string> }) {
  const meta = [
    t.source,
    t.business && !t.source.includes(t.business) ? t.business : null,
    t.assignee ? `→ ${names?.[t.assignee] ?? t.assignee}` : null,
    timeAgo(t.createdAt),
    t.status === "snoozed" && t.snoozedUntil ? `snoozed until ${new Date(t.snoozedUntil).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" })}` : null,
    t.detail,
  ].filter(Boolean);
  const external = t.url && /^https?:/.test(t.url);
  return (
    <li className="flex flex-wrap items-start gap-x-3 gap-y-2 py-2.5">
      <SeverityBadge severity={t.severity} />
      <div className="min-w-0 flex-1 basis-48">
        <div className={`break-words text-sm ${t.status === "done" ? "text-muted line-through" : ""}`}>
          {t.url ? (
            <a href={t.url} target={external ? "_blank" : undefined} rel="noreferrer" className="hover:text-accent">
              {t.title}
              {external && <ExternalLink size={11} className="ml-1 inline align-baseline text-muted" />}
            </a>
          ) : (
            t.title
          )}
          {t.origin === "demo" && <span className="ml-2 rounded bg-low/20 px-1 text-[10px] uppercase tracking-wider text-muted">demo</span>}
        </div>
        <div className="truncate text-xs text-muted">{meta.join(" · ")}</div>
        {!compact && t.actionable && t.fix && <div className="mt-1.5"><FixButton taskId={t.id} label={t.fix} title={t.title} /></div>}
      </div>
      {!compact && t.actionable && <TaskActions id={t.id} status={t.status} manual={t.origin === "manual"} business={t.business} businesses={businesses} assignee={t.assignee ?? null} people={people.filter((p) => p.businesses === null || (!!t.business && p.businesses.includes(t.business)))} />}
    </li>
  );
}
