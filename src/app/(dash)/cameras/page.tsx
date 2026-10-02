import { requireSection } from "@/lib/server/auth";
import Link from "next/link";
import { getDashboard } from "@/lib/server/dashboard";
import { samplesEnabled } from "@/lib/source";
import { HEALTHY_DISK } from "@/lib/devices";
import { Card, Empty, PageHeader, Stat, timeAgo } from "@/components/ui";
import { SnapshotGrid } from "@/components/devices/SnapshotGrid";

const gb = (mb: number | null) => (mb === null ? "—" : mb >= 1_000_000 ? `${(mb / 1_048_576).toFixed(1)} TB` : `${Math.round(mb / 1024)} GB`);

export default async function CamerasPage() {
  await requireSection("cameras");
  const d = await getDashboard();
  const live = d.modes.cameras === "live";
  const sites = d.cameras;
  const channels = sites.flatMap((s) => s.channels);
  const offline = channels.filter((c) => c.online === false).length;
  const badDisks = sites.flatMap((s) => s.disks).filter((x) => !HEALTHY_DISK.has(x.status)).length;
  const failing = d.sources.find((s) => s.source === "Cameras");

  return (
    <>
      <PageHeader mode={d.modes.cameras} title="Cameras" subtitle="Hikvision recorders reached through a secure tunnel: camera status, recorder disks and live snapshots. Alarms arrive in real time through the NVR's alarm server." />
      {d.modes.cameras !== "live" && (
        <Card className="mb-6">
          <p className="text-sm">{d.modes.cameras === "error" ? <>The recorder didn&apos;t answer: <span className="text-critical">{failing?.error}</span></> : samplesEnabled() ? "Showing a sample recorder." : "No recorder connected yet."} Connect a site under <Link href="/platforms#hikvision" className="text-accent hover:underline">Platforms → Hikvision cameras</Link>. The README explains the 5-minute Cloudflare Tunnel setup.</p>
        </Card>
      )}
      {failing?.partial?.length ? (
        <Card className="mb-6"><p className="text-sm text-high">Not reachable right now: {failing.partial.map((p) => p.error).join(" · ")}</p></Card>
      ) : null}

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Sites" value={sites.length} />
        <Stat label="Cameras" value={channels.length} />
        <Stat label="Offline" value={offline} tone={offline ? "high" : "ok"} />
        <Stat label="Disk problems" value={badDisks} tone={badDisks ? "critical" : "ok"} />
      </div>

      {sites.length === 0 && <Empty>No recorder answered yet.</Empty>}
      {sites.map((s) => (
        <section key={s.id} className="mb-8">
          <Card
            title={<>{s.label}{s.business && <span className="ml-2 text-xs font-normal text-muted">{s.business}</span>}</>}
            action={<span className="text-xs text-muted">{[s.device.model, s.device.firmware, `checked ${timeAgo(s.checkedAt)}`].filter(Boolean).join(" · ")}</span>}
          >
            <SnapshotGrid site={s.id} channels={s.channels} live={live} />
            <div className="mt-4 border-t border-line pt-3">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Recording disks</h3>
              {s.disks.length === 0 ? (
                <p className="text-sm text-muted">No disks reported.</p>
              ) : (
                <ul className="grid gap-2 sm:grid-cols-2">
                  {s.disks.map((x) => (
                    <li key={x.id} className="flex items-center justify-between rounded-md border border-line px-3 py-2 text-sm">
                      <span>{x.name} · {gb(x.capacityMB)}</span>
                      <span className={HEALTHY_DISK.has(x.status) ? "text-ok" : "font-semibold text-critical"}>{x.status}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-xs text-muted">Site id for the alarm webhook: <code>{s.id}</code></p>
            </div>
          </Card>
        </section>
      ))}
    </>
  );
}
