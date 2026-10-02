import Link from "next/link";
import { BatteryCharging, Home, PlugZap, Sun } from "lucide-react";
import { getDashboard } from "@/lib/server/dashboard";
import { businessTimeZone } from "@/lib/dates";
import { Card, Empty, PageHeader, Stat, timeAgo } from "@/components/ui";
import { LineChart } from "@/components/LineChart";

const kw = (w: number | null) => (w === null ? "—" : Math.abs(w) >= 1000 ? `${(w / 1000).toFixed(1)} kW` : `${Math.round(w)} W`);

export default async function SolarPage() {
  const d = await getDashboard();
  const tz = businessTimeZone();
  const stations = d.solar;

  return (
    <>
      <PageHeader mode={d.modes.solar} title="Solar" subtitle="Your SOFAR inverter's production, battery and grid, pushed every few minutes by Home Assistant or a small bridge script." />
      {d.modes.solar !== "live" && (
        <Card className="mb-6">
          <p className="text-sm">
            Showing a sample system. Create an ingest token in <Link href="/settings#solar" className="text-accent hover:underline">Settings → Solar</Link>, then have Home Assistant (SOFAR or Solarman integration) post readings to <code>/api/ingest/solar</code>; the README has a copy-paste config. Direct sync with the Fsolar cloud is ready to add once SOFAR grants your account API access.
          </p>
        </Card>
      )}
      {d.modes.solar === "live" && stations.length === 0 && <Empty>Waiting for the first reading. Check that your bridge is sending to /api/ingest/solar with the token.</Empty>}

      {stations.map((s) => {
        const r = s.latest;
        const charging = (r.batteryW ?? 0) > 0;
        const exporting = (r.gridW ?? 0) < 0;
        return (
          <section key={s.station} className="mb-8">
            <div className="mb-3 flex flex-wrap items-baseline gap-x-3">
              <h2 className="text-lg font-semibold">{s.station}</h2>
              {s.business && <span className="text-sm text-muted">{s.business}</span>}
              <span className={`text-xs ${r.status === "fault" ? "text-critical" : r.status === "normal" ? "text-ok" : "text-muted"}`}>{r.status}</span>
              <span className="text-xs text-muted">last reading {timeAgo(r.at)}</span>
            </div>
            {(r.status === "fault" || r.alarms.length > 0) && (
              <Card className="mb-4"><p className="text-sm text-critical">{r.alarms.length ? r.alarms.join(" · ") : "The inverter reports a fault."}</p></Card>
            )}
            <div className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-4">
              <Stat label="Solar now" value={<span className="inline-flex items-center gap-2"><Sun size={18} className="text-high" />{kw(r.powerW)}</span>} hint={r.todayKWh !== null ? `${r.todayKWh} kWh today` : undefined} />
              <Stat label={charging ? "Battery charging" : "Battery"} value={<span className="inline-flex items-center gap-2"><BatteryCharging size={18} />{r.batterySoc === null ? "—" : `${Math.round(r.batterySoc)}%`}</span>} hint={r.batteryW !== null ? `${charging ? "+" : ""}${kw(r.batteryW)}` : undefined} tone={r.batterySoc !== null && r.batterySoc < d.solarConfig.lowBatteryPct ? "high" : "ink"} />
              <Stat label={exporting ? "Exporting to grid" : "Grid import"} value={<span className="inline-flex items-center gap-2"><PlugZap size={18} />{kw(r.gridW === null ? null : Math.abs(r.gridW))}</span>} tone={exporting ? "ok" : "ink"} />
              <Stat label="Home use" value={<span className="inline-flex items-center gap-2"><Home size={18} />{kw(r.loadW)}</span>} hint={r.totalKWh !== null ? `${r.totalKWh.toLocaleString()} kWh lifetime` : undefined} />
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <Card title="Production today">
                {s.todayCurve.length > 1 ? <LineChart points={s.todayCurve.map((p) => ({ date: p.at, value: p.powerW }))} label="Power" unit="W" axis="time" timeZone={tz} /> : <Empty>Not enough readings today yet.</Empty>}
              </Card>
              <Card title="Energy per day">
                {s.daily.length > 1 ? <LineChart points={s.daily} label="Energy" unit="kWh" /> : <Empty>Builds up as readings arrive.</Empty>}
              </Card>
            </div>
          </section>
        );
      })}
    </>
  );
}
