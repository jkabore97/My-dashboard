import { getSnapshot } from "@/lib/aggregate";
import { Card, PageHeader, Stat, StatusDot, Table, td } from "@/components/ui";

export default async function WebsitesPage() {
  const s = await getSnapshot();
  const total = s.websites.reduce((n, w) => n + (w.totalUsers ?? 0), 0);
  const fresh = s.websites.reduce((n, w) => n + (w.newUsers7d ?? 0), 0);
  const visitors = s.websites.reduce((n, w) => n + (w.visitors7d ?? 0), 0);
  return (
    <>
      <PageHeader title="Websites & users" subtitle="Live uptime checks, plus sign-ups from each site's Supabase auth." />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Sites" value={s.websites.length} />
        <Stat label="Registered users" value={total.toLocaleString()} />
        <Stat label="New users (7d)" value={`+${fresh}`} tone="ok" />
        <Stat label="Visitors (7d)" value={visitors ? visitors.toLocaleString() : "—"} hint={visitors ? undefined : "connect analytics"} />
      </div>
      <Card>
        <Table head={["Site", "Business", "Status", "Response", "Users", "New 7d", "Visitors 7d"]}>
          {s.websites.map((w) => (
            <tr key={w.id}>
              <td className={td}><a href={`https://${w.domain}`} target="_blank" rel="noreferrer" className="hover:text-accent">{w.domain}</a></td>
              <td className={`${td} text-muted`}>{w.business}</td>
              <td className={td}><span className="flex items-center gap-2"><StatusDot status={w.status === "up" ? "ok" : w.status === "down" ? "bad" : w.status === "degraded" ? "warn" : "idle"} />{w.status}</span></td>
              <td className={`${td} tabular-nums`}>{w.responseMs != null ? `${w.responseMs} ms` : "—"}</td>
              <td className={`${td} tabular-nums`}>{w.totalUsers?.toLocaleString() ?? "—"}</td>
              <td className={`${td} tabular-nums text-ok`}>{w.newUsers7d != null ? `+${w.newUsers7d}` : "—"}</td>
              <td className={`${td} tabular-nums`}>{w.visitors7d?.toLocaleString() ?? "—"}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
