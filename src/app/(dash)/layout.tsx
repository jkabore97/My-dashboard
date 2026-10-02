import { connection } from "next/server";
import { Shell } from "@/components/shell/Shell";
import { knownBusinesses } from "@/lib/server/reports";
import { AutoRefresh } from "@/components/AutoRefresh";
import { clockZones } from "@/lib/server/clocks";
import { requireUser } from "@/lib/server/auth";
import { getDashboard } from "@/lib/server/dashboard";
import { samplesEnabled } from "@/lib/source";
import { isFullOwner, PATH_SECTION, ROLE_LABEL, canSee } from "@/lib/access";
import { bellFor } from "@/lib/server/alerts/store";
import type { BellData } from "@/components/shell/Bell";

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

  const all = await knownBusinesses().catch(() => [] as string[]);
  // The bell: one small query; an unreachable database just shows it empty.
  const bell: BellData = await bellFor(user)
    .then(({ unread, items }) => ({ unread, items: items.map((i) => ({ id: i.id, taskId: i.taskId, kind: i.kind, severity: i.severity, title: i.title, body: i.body, url: i.url, status: i.status, reason: i.reason, deliverAfter: i.deliverAfter, createdAt: i.createdAt, read: !!i.readAt, acked: !!i.ackedAt })) }))
    .catch(() => ({ unread: 0, items: [] }));
  const businesses = user.businesses === null ? all : all.filter((b) => user.businesses!.includes(b));

  return (
    <Shell counts={counts} email={user.email} name={user.name} role={user.envOwner ? null : ROLE_LABEL[user.role]} allowed={allowed} clocks={clockZones()} businesses={businesses} business={d.business} externalAt={d.externalAt} bell={bell}>
        {d.dbError && (
          <div className="hud-cut mb-5 border border-critical/40 bg-critical/10 px-4 py-3 text-sm">
            <strong className="text-critical">Database unavailable.</strong>{" "}
            <span className="text-muted">Tasks are read-only and history is paused. ({d.dbError})</span>
          </div>
        )}
        {owner && d.allDemo && (
          <div className="hud-cut mb-5 border border-accent/30 bg-accent/10 px-4 py-3 text-sm">
            <strong className="text-accent">{samplesEnabled() ? "Demo data." : "Nothing connected yet."}</strong>{" "}
            <span className="text-muted">{samplesEnabled() ? "Nothing is connected yet. " : ""}Connect platforms on the <a href="/platforms" className="text-accent hover:underline">Platforms</a> page and each section fills in with your data on its own.</span>
          </div>
        )}
        {d.undecryptableConnections > 0 && (
          <div className="hud-cut mb-5 border border-critical/40 bg-critical/10 px-4 py-3 text-sm">
            <strong className="text-critical">Stored connections can&apos;t be decrypted.</strong>{" "}
            <span className="text-muted">{d.undecryptableConnections} connection{d.undecryptableConnections === 1 ? "" : "s"} no longer decrypt{d.undecryptableConnections === 1 ? "s" : ""}. Did ENCRYPTION_KEY change? Restore the old key, or reconnect or disconnect them on the <a href="/platforms" className="text-accent hover:underline">Platforms</a> page. Their tasks are left as they are until then.</span>
          </div>
        )}
        {errors.length > 0 && (
          <div className="hud-cut mb-5 border border-critical/40 bg-critical/10 px-4 py-3 text-sm">
            <strong className="text-critical">Connector errors:</strong>{" "}
            <span className="break-words text-muted">{errors.join(" · ")}</span>
          </div>
        )}
        {children}
        <AutoRefresh at={d.externalAt} />
    </Shell>
  );
}
