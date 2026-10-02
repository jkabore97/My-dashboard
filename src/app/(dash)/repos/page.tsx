import { requireSection } from "@/lib/server/auth";
import { Lock } from "lucide-react";
import { getDashboard } from "@/lib/server/dashboard";
import { Card, PageHeader, Table, td, timeAgo } from "@/components/ui";

export default async function ReposPage() {
  await requireSection("repos");
  const s = await getDashboard();
  return (
    <>
      <PageHeader mode={s.modes.github} title="Repositories" subtitle={`${s.repos.length} active repos, most recently pushed first.`} />
      <Card>
        <Table head={["Repo", "Business", "Language", "Open PRs", "Open issues", "Last push"]}>
          {s.repos.map((r) => (
            <tr key={r.id}>
              <td className={td}>
                <a href={r.url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 hover:text-accent">
                  {r.private && <Lock size={12} className="text-muted" />}{r.fullName}
                </a>
              </td>
              <td className={`${td} text-muted`}>{r.business ?? "—"}</td>
              <td className={`${td} text-muted`}>{r.language ?? "—"}</td>
              <td className={`${td} tabular-nums ${r.openPullRequests ? "text-medium" : "text-muted"}`}>{r.openPullRequests ?? "—"}</td>
              <td className={`${td} tabular-nums ${(r.openIssues ?? 0) >= 10 ? "text-high" : "text-muted"}`}>{r.openIssues ?? "—"}</td>
              <td className={`${td} text-muted`}>{timeAgo(r.pushedAt)}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
