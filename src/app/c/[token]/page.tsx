import type { Metadata } from "next";
import { connection } from "next/server";
import { clientPage } from "@/lib/server/portal";
import { formatDate } from "@/lib/dates";

// A client's read-only status page: their sites' uptime and their projects.
// Public by link (the link is the secret); never indexed, never cached.

export const metadata: Metadata = { title: "Status", referrer: "no-referrer", robots: { index: false, follow: false } };

const STATUS = {
  up: { label: "Operational", dot: "bg-ok", text: "text-ok" },
  degraded: { label: "Slow or partly down", dot: "bg-high", text: "text-high" },
  down: { label: "Down", dot: "bg-critical", text: "text-critical" },
  unknown: { label: "Not checked yet", dot: "bg-low", text: "text-muted" },
} as const;

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto min-h-screen max-w-3xl px-4 py-10 sm:px-6">{children}</main>;
}

export default async function ClientStatusPage({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  const page = await clientPage(token).catch(() => null);
  if (page === "busy") return <Shell><p className="text-sm text-muted">This page is getting a lot of visits. Try again in a minute.</p></Shell>;
  if (!page) {
    return (
      <Shell>
        <h1 className="text-xl font-semibold">Link not available</h1>
        <p className="mt-2 text-sm text-muted">This status link isn&apos;t valid any more. Ask your contact for a new one.</p>
      </Shell>
    );
  }
  return (
    <Shell>
      <p className="text-xs uppercase tracking-[0.2em] text-muted">{page.business ?? "Status"}</p>
      <h1 className="mt-1 text-2xl font-semibold">{page.client}</h1>
      <p className="mt-1 text-sm text-muted">Live status of your sites and projects.</p>

      {page.sites.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted">Websites</h2>
          <div className="grid gap-4">
            {page.sites.map((s) => {
              const st = STATUS[s.status] ?? STATUS.unknown;
              return (
                <div key={s.domain} className="rounded-xl border border-line bg-panel p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{s.domain}</span>
                    <span className={`flex items-center gap-2 text-sm ${st.text}`}><span className={`h-2 w-2 rounded-full ${st.dot}`} />{st.label}</span>
                  </div>
                  <div className="mt-3 flex h-6 gap-0.5" aria-label="Last 24 hours, hour by hour">
                    {s.hours.map((h, i) => (
                      <span key={i} title={h === null ? "no checks" : `${Math.round(h * 100)}% up`} className={`flex-1 rounded-sm ${h === null ? "bg-line" : h >= 0.99 ? "bg-ok" : h >= 0.5 ? "bg-high" : "bg-critical"}`} />
                    ))}
                  </div>
                  <div className="mt-1 flex justify-between text-[11px] text-muted"><span>24 hours ago</span><span>now</span></div>
                  <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
                    <div><dt className="text-xs text-muted">Uptime, 7 days</dt><dd className="tabular-nums">{s.uptime7d === null ? "—" : `${s.uptime7d}%`}</dd></div>
                    <div><dt className="text-xs text-muted">Uptime, 30 days</dt><dd className="tabular-nums">{s.uptime30d === null ? "—" : `${s.uptime30d}%`}</dd></div>
                    <div><dt className="text-xs text-muted">Response</dt><dd className="tabular-nums">{s.responseMs === null ? "—" : `${s.responseMs} ms`}</dd></div>
                  </dl>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {page.projects && (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted">Projects</h2>
          {page.projects.length === 0 ? (
            <p className="text-sm text-muted">No active projects.</p>
          ) : (
            <ul className="divide-y divide-line rounded-xl border border-line bg-panel">
              {page.projects.map((p, i) => (
                <li key={i} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3">
                  <span>{p.title}</span>
                  <span className="text-sm text-muted">{p.stage}{p.expectedClose ? ` · expected ${formatDate(p.expectedClose)}` : p.closedOn ? ` · since ${formatDate(p.closedOn)}` : ""}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <p className="mt-10 text-xs text-muted">Checked every 5 minutes. Times are approximate.</p>
    </Shell>
  );
}
