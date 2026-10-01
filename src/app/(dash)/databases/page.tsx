import { getDashboard } from "@/lib/server/dashboard";
import { Card, PageHeader, SeverityBadge, StatusDot, Table, td, timeAgo } from "@/components/ui";

const DOT = { healthy: "ok", degraded: "bad", paused: "idle", unknown: "idle" } as const;

export default async function DatabasesPage() {
  const s = await getDashboard();
  return (
    <>
      <PageHeader mode={s.modes.supabase === "live" || s.modes.d1 === "live" ? "live" : s.modes.supabase} title="Databases" subtitle="Supabase projects (with security and performance advisors) and Cloudflare D1." />
      <Card>
        <Table head={["Database", "Provider", "Business", "Region", "Status", "Advisories", "Created"]}>
          {s.databases.map((d) => (
            <tr key={d.id}>
              <td className={td}>
                {d.provider === "supabase" ? <a href={`https://supabase.com/dashboard/project/${d.id}`} target="_blank" rel="noreferrer" className="hover:text-accent">{d.name}</a> : d.name}
              </td>
              <td className={`${td} text-muted`}>{d.provider}</td>
              <td className={`${td} text-muted`}>{d.business ?? "—"}</td>
              <td className={`${td} text-muted`}>{d.region ?? "—"}</td>
              <td className={td}><span className="flex items-center gap-2"><StatusDot status={DOT[d.status]} />{d.status}</span></td>
              <td className={td}>
                {d.advisories?.length ? (
                  <ul className="space-y-1">{d.advisories.slice(0, 3).map((a, i) => <li key={i} className="flex items-center gap-2 text-xs"><SeverityBadge severity={a.level} /><span className="line-clamp-1">{a.title}</span></li>)}</ul>
                ) : <span className="text-muted">—</span>}
              </td>
              <td className={`${td} text-muted`}>{timeAgo(d.createdAt)}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
