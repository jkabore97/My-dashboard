import { connection } from "next/server";
import { Sidebar } from "@/components/Sidebar";
import { getSnapshot } from "@/lib/aggregate";

export default async function DashLayout({ children }: { children: React.ReactNode }) {
  // Render per request; connector fetches are still cached for 2 minutes.
  await connection();
  const snap = await getSnapshot();
  const counts = {
    "/tasks": snap.tasks.filter((t) => t.severity === "critical").length,
    "/inbox": snap.emails.filter((e) => e.unread && e.severity === "critical").length,
    "/websites": snap.websites.filter((w) => w.status === "down").length,
  };
  const errors = snap.sources.filter((s) => s.mode === "error");

  return (
    <div className="lg:flex">
      <Sidebar counts={counts} />
      <main className="min-w-0 flex-1 px-4 py-6 sm:px-8">
        {snap.allDemo && (
          <div className="mb-6 rounded-lg border border-accent/30 bg-accent/10 px-4 py-3 text-sm">
            <strong className="text-accent">Demo data.</strong>{" "}
            <span className="text-muted">Nothing is connected yet. Add API keys (see <code>.env.example</code>) and each section switches to live data on its own.</span>
          </div>
        )}
        {errors.length > 0 && (
          <div className="mb-6 rounded-lg border border-critical/40 bg-critical/10 px-4 py-3 text-sm">
            <strong className="text-critical">Connector errors:</strong>{" "}
            <span className="text-muted">{errors.map((e) => `${e.source} (${e.error})`).join(" · ")}</span>
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
