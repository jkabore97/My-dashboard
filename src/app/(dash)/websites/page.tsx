import Link from "next/link";
import { requireUser } from "@/lib/server/auth";
import { getDashboard } from "@/lib/server/dashboard";
import { snapshotHistory } from "@/lib/server/store/snapshots";
import { Card, PageHeader, Stat, StatusDot, Table, td } from "@/components/ui";
import { UptimeStrip, type UptimePoint } from "@/components/UptimeStrip";

export default async function WebsitesPage() {
  await requireUser(); // reads the database directly below
  const s = await getDashboard();
  const history = new Map<string, UptimePoint[]>();
  if (!s.dbError) {
    for (const h of await snapshotHistory<Omit<UptimePoint, "takenAt">>("website", 24)) {
      const list = history.get(h.key) ?? [];
      list.push({ ...h.data, takenAt: h.takenAt });
      history.set(h.key, list);
    }
  }
  const total = s.websites.reduce((n, w) => n + (w.totalUsers ?? 0), 0);
  const fresh = s.websites.reduce((n, w) => n + (w.newUsers7d ?? 0), 0);
  const visitors = s.websites.reduce((n, w) => n + (w.visitors7d ?? 0), 0);
  return (
    <>
      <PageHeader mode={s.modes.websites} title="Websites & users" subtitle="Uptime checked every 5 minutes, plus sign-ups from each site's Supabase auth.">
        <Link href="/settings#websites" className="text-sm text-accent hover:underline">Edit sites →</Link>
      </PageHeader>
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Sites" value={s.websites.length} />
        <Stat label="Registered users" value={total.toLocaleString()} />
        <Stat label="New users (7d)" value={`+${fresh}`} tone="ok" />
        <Stat label="Visitors (7d)" value={visitors ? visitors.toLocaleString() : "—"} hint={visitors ? undefined : "analytics arrives in Phase 3"} />
      </div>
      <Card>
        <Table head={["Site", "Business", "Status", "Last 24 hours", "Response", "Users", "New 7d"]}>
          {s.websites.map((w) => (
            <tr key={w.id}>
              <td className={td}><a href={`https://${w.domain}`} target="_blank" rel="noreferrer" className="hover:text-accent">{w.domain}</a></td>
              <td className={`${td} text-muted`}>{w.business}</td>
              <td className={td}><span className="flex items-center gap-2"><StatusDot status={w.status === "up" ? "ok" : w.status === "down" ? "bad" : w.status === "degraded" ? "warn" : "idle"} />{w.status}</span></td>
              <td className={td}><UptimeStrip points={history.get(w.domain) ?? []} /></td>
              <td className={`${td} tabular-nums`}>{w.responseMs != null ? `${w.responseMs} ms` : "—"}</td>
              <td className={`${td} tabular-nums`}>{w.totalUsers?.toLocaleString() ?? "—"}</td>
              <td className={`${td} tabular-nums text-ok`}>{w.newUsers7d != null ? `+${w.newUsers7d}` : "—"}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
