import { connection } from "next/server";
import { Sidebar } from "@/components/Sidebar";
import { requireUser } from "@/lib/server/auth";
import { getDashboard } from "@/lib/server/dashboard";
import { isFullOwner, PATH_SECTION, ROLE_LABEL, canSee } from "@/lib/access";

export default async function DashLayout({ children }: { children: React.ReactNode }) {
  // Render per request; connector fetches are still cached for 2 minutes.
  await connection();
  const user = await requireUser();
  const d = await getDashboard();
  const counts = {
    "/tasks": d.openTasks.filter((t) => t.severity === "critical").length,
    "/inbox": d.emails.filter((e) => e.unread && e.severity === "critical").length,
    "/websites": d.websites.filter((w) => w.status === "down").length,
  };
  const owner = isFullOwner(user);
  const allowed = Object.keys(PATH_SECTION).filter((p) => canSee(user, PATH_SECTION[p]));
  const errors = !owner ? [] : d.sources.flatMap((s) => (s.mode === "error" ? [`${s.source} (${s.error})`] : (s.partial ?? []).map((p) => `${s.source} (${p.error})`)));

  return (
    <div className="lg:flex">
      <Sidebar counts={counts} email={user.email} name={user.name} role={user.envOwner ? null : ROLE_LABEL[user.role]} allowed={allowed} />
      <main className="min-w-0 flex-1 px-4 py-6 sm:px-8">
        {d.dbError && (
          <div className="mb-6 rounded-lg border border-critical/40 bg-critical/10 px-4 py-3 text-sm">
            <strong className="text-critical">Database unavailable.</strong>{" "}
            <span className="text-muted">Tasks are read-only and history is paused. ({d.dbError})</span>
          </div>
        )}
        {owner && d.allDemo && (
          <div className="mb-6 rounded-lg border border-accent/30 bg-accent/10 px-4 py-3 text-sm">
            <strong className="text-accent">Demo data.</strong>{" "}
            <span className="text-muted">Nothing is connected yet. Connect platforms on the <a href="/platforms" className="text-accent hover:underline">Platforms</a> page and each section switches to live data on its own.</span>
          </div>
        )}
        {d.undecryptableConnections > 0 && (
          <div className="mb-6 rounded-lg border border-critical/40 bg-critical/10 px-4 py-3 text-sm">
            <strong className="text-critical">Stored connections can&apos;t be decrypted.</strong>{" "}
            <span className="text-muted">{d.undecryptableConnections} connection{d.undecryptableConnections === 1 ? "" : "s"} no longer decrypt{d.undecryptableConnections === 1 ? "s" : ""}. Did ENCRYPTION_KEY change? Restore the old key, or reconnect or disconnect them on the <a href="/platforms" className="text-accent hover:underline">Platforms</a> page. Their tasks are left as they are until then.</span>
          </div>
        )}
        {errors.length > 0 && (
          <div className="mb-6 rounded-lg border border-critical/40 bg-critical/10 px-4 py-3 text-sm">
            <strong className="text-critical">Connector errors:</strong>{" "}
            <span className="break-words text-muted">{errors.join(" · ")}</span>
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
