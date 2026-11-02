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
    .then(({ unread, urgent, items }) => ({ unread, urgent, items: items.map((i) => ({ id: i.id, taskId: i.taskId, kind: i.kind, severity: i.severity, title: i.title, body: i.body, url: i.url, status: i.status, reason: i.reason, deliverAfter: i.deliverAfter, createdAt: i.createdAt, read: !!i.readAt, acked: !!i.ackedAt })) }))
    .catch(() => ({ unread: 0, urgent: 0, items: [] }));
  const businesses = user.businesses === null ? all : all.filter((b) => user.businesses!.includes(b));

  return (
    <Shell counts={counts} email={user.email} name={user.name} role={user.envOwner ? null : ROLE_LABEL[user.role]} allowed={allowed} clocks={clockZones()} businesses={businesses} business={d.business} externalAt={d.externalAt} bell={bell}>
        {d.dbError && (
          <div className="mb-4 rounded-[14px] bg-critical/10 px-4 py-3 text-[14px]">
            <strong className="text-critical">Database unavailable.</strong>{" "}
            <span className="text-muted">Tasks are read-only and history is paused. ({d.dbError})</span>
          </div>
        )}
        {owner && d.allDemo && (
          <div className="mb-4 rounded-[14px] bg-accent/10 px-4 py-3 text-[14px]">
            <strong className="text-accent">{samplesEnabled() ? "Demo data." : "Nothing connected yet."}</strong>{" "}
            <span className="text-muted">{samplesEnabled() ? "Nothing is connected yet. " : ""}Connect platforms on the <a href="/platforms" className="text-accent hover:underline">Platforms</a> page and each section fills in with your data on its own.</span>
          </div>
        )}
        {d.undecryptableConnections > 0 && (
          <div className="mb-4 rounded-[14px] bg-critical/10 px-4 py-3 text-[14px]">
            <strong className="text-critical">Stored connections can&apos;t be decrypted.</strong>{" "}
            <span className="text-muted">{d.undecryptableConnections} connection{d.undecryptableConnections === 1 ? "" : "s"} no longer decrypt{d.undecryptableConnections === 1 ? "s" : ""}. Did ENCRYPTION_KEY change? Restore the old key, or reconnect or disconnect them on the <a href="/platforms" className="text-accent hover:underline">Platforms</a> page. Their tasks are left as they are until then.</span>
          </div>
        )}
        {errors.length > 0 && (
          <div className="mb-4 rounded-[14px] bg-critical/10 px-4 py-3 text-[14px]">
            <strong className="text-critical">{errors.length === 1 ? "A connection needs attention" : `${errors.length} connections need attention`}</strong>
            <ul className="mt-1 space-y-0.5">
              {errors.map((e) => <li key={e} title={e} className="break-words text-muted">{friendlyError(e)}</li>)}
            </ul>
            <a href="/platforms" className="mt-1 inline-block font-medium text-accent hover:underline">Open Platforms</a>
          </div>
        )}
        {children}
        <AutoRefresh at={d.externalAt} />
    </Shell>
  );
}

/** "GitHub (401 Unauthorized from api.github.com: {…})" → "GitHub: the sign-in expired or was revoked. Reconnect it." (full text stays in the tooltip). */
function friendlyError(e: string): string {
  const m = e.match(/^([^(]+?)\s*\((.*)\)\s*$/s);
  const name = (m?.[1] ?? "").trim();
  const detail = m?.[2] ?? e;
  const code = detail.match(/\b([45]\d\d)\b/)?.[1];
  const why =
    code === "401" ? "the sign-in or token expired or was revoked. Reconnect it."
    : code === "403" ? "permission was refused. Check the token's or app's permissions, then reconnect."
    : code === "404" ? "the account or resource wasn't found. Check the connection's settings."
    : code === "429" ? "too many requests right now. It retries on its own."
    : code?.startsWith("5") ? "the platform is having problems on its side. It retries on its own."
    : /timed? ?out|abort/i.test(detail) ? "it didn't answer in time. It retries on its own."
    : detail.length > 140 ? `${detail.slice(0, 140)}…` : detail;
  return name ? `${name}: ${why}` : why;
}
