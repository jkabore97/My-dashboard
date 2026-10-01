import { getDashboard } from "@/lib/server/dashboard";
import { Card, PageHeader, StatusDot, Table, td, timeAgo } from "@/components/ui";

const DOT = { ready: "ok", building: "warn", queued: "warn", error: "bad", canceled: "idle" } as const;

export default async function HostingPage() {
  const s = await getDashboard();
  return (
    <>
      <PageHeader mode={s.modes.vercel === "live" || s.modes.workers === "live" ? "live" : s.modes.vercel} title="Hosting" subtitle="Vercel projects and Cloudflare Workers with their latest production deploy." />
      <Card>
        <Table head={["Project", "Provider", "Business", "Last deploy", "When", "URL"]}>
          {s.hosting.map((h) => (
            <tr key={h.id}>
              <td className={td}>{h.name}<div className="text-xs text-muted">{h.framework ?? ""}</div></td>
              <td className={`${td} capitalize text-muted`}>{h.provider}</td>
              <td className={`${td} text-muted`}>{h.business ?? "—"}</td>
              <td className={td}><span className="flex items-center gap-2"><StatusDot status={h.lastDeployState ? DOT[h.lastDeployState] : "idle"} />{h.lastDeployState ?? "—"}</span></td>
              <td className={`${td} text-muted`}>{timeAgo(h.lastDeployAt)}</td>
              <td className={td}>{h.url ? <a href={h.url} target="_blank" rel="noreferrer" className="text-accent hover:underline">{h.url.replace(/^https?:\/\//, "")}</a> : "—"}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
