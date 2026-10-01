import { getDashboard } from "@/lib/server/dashboard";
import { Card, Empty, PageHeader, SeverityBadge, timeAgo } from "@/components/ui";

export default async function NotificationsPage() {
  const s = await getDashboard();
  return (
    <>
      <PageHeader title="Notifications" subtitle="Email, GitHub, Vercel, Stripe, Supabase and uptime events, newest first. Kept for 90 days." />
      <Card>
        {s.notifications.length === 0 ? <Empty>All quiet.</Empty> : (
          <ul className="-my-2 divide-y divide-line">
            {s.notifications.map((n) => (
              <li key={n.id} className="flex items-start gap-3 py-3">
                <SeverityBadge severity={n.severity} />
                <div className="min-w-0 flex-1">
                  {n.url ? <a href={n.url} target="_blank" rel="noreferrer" className="text-sm hover:text-accent">{n.title}</a> : <span className="text-sm">{n.title}</span>}
                  <div className="truncate text-xs text-muted">{n.source}{n.body ? ` · ${n.body}` : ""}</div>
                </div>
                <span className="shrink-0 text-xs text-muted">{timeAgo(n.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
