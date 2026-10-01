import { connection } from "next/server";
import { Sidebar } from "@/components/Sidebar";
import { requireUser } from "@/lib/server/auth";
import { getDashboard } from "@/lib/server/dashboard";

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
  const errors = d.sources.filter((s) => s.mode === "error");

  return (
    <div className="lg:flex">
      <Sidebar counts={counts} email={user.email} />
      <main className="min-w-0 flex-1 px-4 py-6 sm:px-8">
        {d.dbError && (
          <div className="mb-6 rounded-lg border border-critical/40 bg-critical/10 px-4 py-3 text-sm">
            <strong className="text-critical">Database unavailable.</strong>{" "}
            <span className="text-muted">Tasks are read-only and history is paused. ({d.dbError})</span>
          </div>
        )}
        {d.allDemo && (
          <div className="mb-6 rounded-lg border border-accent/30 bg-accent/10 px-4 py-3 text-sm">
            <strong className="text-accent">Demo data.</strong>{" "}
            <span className="text-muted">Nothing is connected yet. Connect platforms on the <a href="/platforms" className="text-accent hover:underline">Platforms</a> page and each section switches to live data on its own.</span>
          </div>
        )}
        {errors.length > 0 && (
          <div className="mb-6 rounded-lg border border-critical/40 bg-critical/10 px-4 py-3 text-sm">
            <strong className="text-critical">Connector errors:</strong>{" "}
            <span className="break-words text-muted">{errors.map((e) => `${e.source} (${e.error})`).join(" · ")}</span>
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
