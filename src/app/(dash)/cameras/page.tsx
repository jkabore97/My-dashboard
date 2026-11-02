import { requireSection } from "@/lib/server/auth";
import Link from "next/link";
import { getDashboard } from "@/lib/server/dashboard";
import { samplesEnabled, env } from "@/lib/source";
import { HEALTHY_DISK } from "@/lib/devices";
import { businessTimeZone } from "@/lib/dates";
import { firmwareAdvisory } from "@/lib/connectors/hikvision";
import { getSetting } from "@/lib/server/store/settings";
import { WEBHOOK_ENV } from "@/lib/server/webhooks";
import { btn, Card, Empty, ModePill, PageHeader, SeverityBadge, SeverityIcon, Stat, SYS, Tag, timeAgo } from "@/components/ui";
import { SnapshotGrid } from "@/components/devices/SnapshotGrid";
import { cameraAlarms, diskSize, diskUsedPct } from "@/components/sites/alarms";
import { Kv, Meter } from "@/components/sites/bits";

const FIRMWARE_URL = "https://www.hikvision.com/en/support/download/firmware/";

export default async function CamerasPage() {
  await requireSection("cameras");
  const d = await getDashboard();
  const live = d.modes.cameras === "live";
  const sites = d.cameras;
  const channels = sites.flatMap((s) => s.channels);
  const online = channels.filter((c) => c.online === true).length;
  const offline = channels.filter((c) => c.online === false);
  const disks = sites.flatMap((s) => s.disks);
  const badDisks = disks.filter((x) => !HEALTHY_DISK.has(x.status)).length;
  const failing = d.sources.find((s) => s.source === "Cameras");
  const tz = businessTimeZone();
  const alarms = live ? cameraAlarms(d.notifications, tz) : [];
  const alarmServer = !!env(WEBHOOK_ENV.hikvision) || (!d.dbError && !!(await getSetting<string | null>("webhook_secret:hikvision", null).catch(() => null)));
  const advisories = sites.flatMap((s) => {
    const a = firmwareAdvisory(s.device);
    return a ? [{ site: s, ...a }] : [];
  });

  return (
    <>
      <PageHeader mode={d.modes.cameras} title="Cameras" subtitle="Hikvision recorders through a secure tunnel · status, disks and live snapshots · alarms in real time">
        {live && <ModePill mode="live" />}
              </PageHeader>

      {d.modes.cameras !== "live" && (
        <div className="mb-5 rounded-[14px] bg-accent/10 px-4 py-3 text-[15px] text-ink">
          <p>{d.modes.cameras === "error" ? <>The recorder didn&apos;t answer: <span className="text-critical">{failing?.error}</span></> : samplesEnabled() ? "Showing a sample recorder." : "No recorder connected yet."} Connect a site under <Link href="/platforms#hikvision" className="text-cyan hover:underline">Platforms → Hikvision cameras</Link>. The README explains the 5-minute Cloudflare Tunnel setup.</p>
        </div>
      )}
      {failing?.partial?.length ? (
        <div className="mb-5 flex items-start gap-3 rounded-[14px] bg-high/12 px-4 py-3">
          <SeverityIcon severity="high" />
          <p className="text-[15px] text-ink"><span className="mr-2 font-semibold text-warn">High</span>Not reachable right now: {failing.partial.map((p) => p.error).join(" · ")}</p>
        </div>
      ) : null}

      <div className="mb-5 grid grid-cols-2 gap-2.5 sm:gap-4 md:grid-cols-4">
        <Stat label="Sites" value={sites.length} hint={sites.map((s) => s.label).join(" · ") || "none yet"} />
        <Stat label="Cameras" value={<>{channels.length}</>} hint={channels.length ? `${online} online` : "none reported"} />
        <Stat label="Offline" value={offline.length} tone={offline.length ? "high" : "ink"} hint={offline.length ? offline.map((c) => c.name).join(", ") : "every camera answering"} />
        <Stat label="Disk problems" value={badDisks} tone={badDisks ? "critical" : "ink"} hintTone={badDisks ? undefined : "ok"} hint={`${disks.length} disk${disks.length === 1 ? "" : "s"}${disks.length ? (badDisks ? "" : " · healthy") : ""}`} />
      </div>

      {advisories.map((a) => (
        <div key={a.site.id} className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-[14px] bg-high/12 px-4 py-3.5 sm:px-5">
          <SeverityIcon severity="high" size={26} />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold text-warn">Advisory · Firmware</div>
            <div className="mt-0.5 text-[15px] font-semibold text-ink">{a.site.label}: recorder firmware {a.site.device.firmware ?? ""} is from {a.year}</div>
            <div className="text-[13px] text-muted">The {a.site.device.model ?? "recorder"} reports a firmware build from {a.date}, over {a.ageYears} years old. Hikvision publishes security fixes in newer builds: check for one for this model and update during a quiet hour; recordings are kept.</div>
          </div>
          <a href={FIRMWARE_URL} target="_blank" rel="noreferrer" className={`${btn()} min-h-10 sm:min-h-0`}>Firmware downloads</a>
        </div>
      ))}

      {sites.length === 0 && <Card className="mb-5" flush><Empty>No recorder answered yet.</Empty></Card>}
      {sites.map((s) => (
        <Card
          key={s.id}
          flush
          className="mb-5"
          title={<>{s.label}{s.business && <> · {s.business}</>}</>}
          action={<span>{[s.device.model, s.device.firmware, `checked ${timeAgo(s.checkedAt)}`].filter(Boolean).join(" · ")}</span>}
        >
          <SnapshotGrid site={s.id} channels={s.channels} live={live} />
        </Card>
      ))}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="grid content-start gap-5 lg:col-span-2">
          {sites.map((s) => {
            const advisory = firmwareAdvisory(s.device);
            return (
              <Card key={s.id} flush title={sites.length > 1 ? `Recording disks · ${s.label}` : "Recording disks"} action={`checked ${timeAgo(s.checkedAt)}`}>
                <div className="grid gap-3.5 p-3 sm:grid-cols-2 sm:p-4">
                  {s.disks.length === 0 && (
                    <div className="rounded-xl bg-panel-2 p-3.5 text-[15px] text-muted">No disks reported{s.warnings?.some((w) => w.startsWith("disk")) ? " (disk status couldn't be read this round)" : ""}.</div>
                  )}
                  {s.disks.map((x) => {
                    const healthy = HEALTHY_DISK.has(x.status);
                    const used = diskUsedPct(x.capacityMB, x.freeMB);
                    return (
                      <div key={x.id} className={`rounded-xl p-3.5 ${healthy ? "bg-panel-2" : "bg-critical/10"}`}>
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <b className="font-semibold text-ink">{x.name}{diskSize(x.capacityMB) ? ` · ${diskSize(x.capacityMB)}` : ""}</b>
                          {healthy ? <Tag color={SYS.green}>{x.status}</Tag> : <span className="flex items-center gap-1.5"><SeverityIcon severity="critical" size={18} /><SeverityBadge severity="critical" /></span>}
                        </div>
                        {used !== null && (
                          <>
                            <Meter pct={used} />
                            <div className="mt-1.5 flex justify-between text-[13px] text-muted"><span className="tabular-nums">{used}% used</span><span className="tabular-nums">{diskSize(x.freeMB)} free</span></div>
                          </>
                        )}
                        <div className="mt-2">
                          <Kv label="Status" valueClass={healthy ? "text-ok" : "text-critical"}>{healthy ? x.status : `${x.status}: recording may have stopped`}</Kv>
                        </div>
                      </div>
                    );
                  })}
                  <div className="rounded-xl bg-panel-2 p-3.5">
                    <div className="mb-1 flex items-center justify-between gap-2"><b className="font-semibold text-ink">Recorder</b><Tag color={SYS.blue}>Info</Tag></div>
                    {s.device.name && <Kv label="Name">{s.device.name}</Kv>}
                    <Kv label="Model">{s.device.model ?? "—"}</Kv>
                    <Kv label="Firmware" valueClass={advisory ? "text-warn" : ""}>{s.device.firmware ?? "—"}{s.device.firmwareDate ? ` · ${s.device.firmwareDate.slice(0, 4)}` : ""}</Kv>
                    <Kv label="Cameras">{s.channels.length} · {s.channels.filter((c) => c.online).length} online</Kv>
                  </div>
                </div>
                <p className="px-4 pb-4 text-[13px] text-muted sm:px-5">Site id for the alarm webhook: <code className="break-all rounded-md bg-fill px-1.5 py-0.5 font-mono text-[12.5px] text-ink">{s.id}</code></p>
              </Card>
            );
          })}
        </div>

        <Card flush title="Alarms · 7 days" action="NVR alarm server" className="self-start">
          {!live ? (
            <p className="px-4 py-8 text-center text-[15px] text-muted sm:px-5">Alarms appear here once a recorder is connected and its alarm server points at this dashboard.</p>
          ) : alarms.length === 0 ? (
            <p className="px-4 py-8 text-center text-[15px] text-muted sm:px-5">
              {alarmServer ? "No alarms received in the last 7 days." : <>The alarm server isn&apos;t set up yet. Set a secret under <Link href="/platforms#hikvision" className="text-cyan hover:underline">Platforms → Hikvision NVR alarms</Link>, then point the NVR at it.</>}
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {alarms.map((a) => (
                <li key={a.id} className="grid grid-cols-[54px_1fr] gap-2.5 px-4 py-2.5 text-[15px] sm:px-5">
                  <span className="pt-0.5 text-[13px] text-muted tabular-nums">{a.when}</span>
                  <div className="min-w-0">
                    <div className="flex items-start gap-2">
                      {a.severity !== "low" && <SeverityIcon severity={a.severity} size={16} />}
                      <span className="min-w-0 break-words text-ink">{a.title}</span>
                    </div>
                    {(a.body || a.severity !== "low") && <div className="text-[13px] text-muted">{[a.severity !== "low" ? a.severity[0].toUpperCase() + a.severity.slice(1) : null, a.body].filter(Boolean).join(" · ")}</div>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
