import { ExternalLink } from "lucide-react";
import type { Task } from "@/lib/types";
import { SeverityBadge, timeAgo } from "./ui";

export function TaskRow({ task: t }: { task: Task }) {
  return (
    <li className="flex items-start gap-3 py-2.5">
      <SeverityBadge severity={t.severity} />
      <div className="min-w-0 flex-1">
        <div className="break-words text-sm">{t.title}</div>
        <div className="truncate text-xs text-muted">
          {t.source}{t.business && !t.source.includes(t.business) ? ` · ${t.business}` : ""} · {timeAgo(t.createdAt)}{t.detail ? ` · ${t.detail}` : ""}
        </div>
      </div>
      {t.url && (
        <a href={t.url} target="_blank" rel="noreferrer" aria-label="Open" className="rounded p-1 text-muted hover:bg-panel-2 hover:text-ink">
          <ExternalLink size={14} />
        </a>
      )}
    </li>
  );
}
