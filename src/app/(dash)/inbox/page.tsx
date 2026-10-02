import { requireSection } from "@/lib/server/auth";
import Link from "next/link";
import { getDashboard } from "@/lib/server/dashboard";
import { Sparkles } from "lucide-react";
import { Card, Empty, PageHeader, SeverityBadge, timeAgo } from "@/components/ui";
import { DraftReply } from "@/components/ai/DraftReply";
import { aiEnabled } from "@/lib/server/ai";

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ account?: string }> }) {
  await requireSection("inbox");
  const { account } = await searchParams;
  const s = await getDashboard();
  const accounts = [...new Set(s.emails.map((e) => e.account))].sort();
  const emails = account ? s.emails.filter((e) => e.account === account) : s.emails;
  const ai = aiEnabled() && s.modes.inbox === "live";

  return (
    <>
      <PageHeader mode={s.modes.inbox} title="Inbox" subtitle={`Every business mailbox in one list, triaged by urgency${ai ? " (read by Claude)" : ""}. Replies open in Gmail or Outlook.`} />
      <div className="mb-6 flex flex-wrap gap-2">
        {[undefined, ...accounts].map((a) => (
          <Link key={a ?? "all"} href={a ? `/inbox?account=${encodeURIComponent(a)}` : "/inbox"} className={`rounded-full border px-3 py-1 text-xs ${account === a ? "border-accent bg-accent/15 text-accent" : "border-line text-muted hover:text-ink"}`}>{a ?? "All accounts"}</Link>
        ))}
      </div>
      <Card>
        {emails.length === 0 ? <Empty>No mail in the last 14 days.</Empty> : (
          <ul className="-my-2 divide-y divide-line">
            {emails.map((e) => (
              <li key={e.id}>
                <a href={e.url} target="_blank" rel="noreferrer" className="flex items-start gap-3 py-3 hover:bg-panel-2/40">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${e.unread ? "bg-accent" : "bg-transparent"}`} />
                  <SeverityBadge severity={e.severity} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className={`truncate text-sm ${e.unread ? "font-semibold" : ""}`}>{e.subject}</span>
                      <span className="shrink-0 text-xs text-muted">{timeAgo(e.receivedAt)}</span>
                    </div>
                    <div className="truncate text-xs text-muted">{e.from} · {e.account}</div>
                    {e.triage ? (
                      <div className="mt-0.5 text-xs text-ink/80"><Sparkles size={10} className="mr-1 inline text-accent" />{e.triage.summary}{e.triage.task ? <span className="text-muted"> · To do: {e.triage.task}</span> : null}</div>
                    ) : (
                      <div className="mt-0.5 line-clamp-1 text-xs text-muted/80">{e.snippet}</div>
                    )}
                  </div>
                </a>
                {ai && (!e.triage || e.triage.needsReply) && e.unread && <DraftReply emailId={e.id} url={e.url} />}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
