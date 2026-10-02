import type { CSSProperties } from "react";
import { requireSection } from "@/lib/server/auth";
import Link from "next/link";
import { BatteryCharging, Home, PlugZap, Sun } from "lucide-react";
import { getDashboard } from "@/lib/server/dashboard";
import { samplesEnabled } from "@/lib/source";
import { businessTimeZone } from "@/lib/dates";
import { isDaylight } from "@/lib/solar";
import type { SolarStationView } from "@/lib/connectors/solar";
import { BizLabel, Card, PageHeader, SeverityIcon, Stat, Tag, timeAgo } from "@/components/ui";
import { Kv } from "@/components/sites/bits";
import { energyFlow, watts } from "@/components/sites/flow";
import { BatteryRing, EnergyFlow } from "@/components/sites/EnergyFlow";
import { DailyBars, ProductionChart } from "@/components/sites/SolarCharts";

const STATUS_COLOR = { normal: "#3df5a0", fault: "#ff3d6e", standby: "#7f97ab", offline: "#7f97ab", unknown: "#7f97ab" } as const;

function hourOfDay(iso: string, tz: string) {
  const d = new Date(iso);
  try {
    const [h, m] = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d).split(":").map(Number);
    return h + m / 60;
  } catch {
    return d.getUTCHours() + d.getUTCMinutes() / 60;
  }
}
const hm = (iso: string, tz: string) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
const shortDay = (date: string) => new Intl.DateTimeFormat("en-US", { day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));

export default async function SolarPage() {
  await requireSection("solar");
  const d = await getDashboard();
  const tz = businessTimeZone();
  const cfg = d.solarConfig;
  const stations = d.solar as SolarStationView[];
  const now = new Date();
  const night = !isDaylight(cfg, tz, now);
  const nowH = hourOfDay(now.toISOString(), tz);
  const pad = (h: number) => `${String(h).padStart(2, "0")}:00`;

  return (
    <>
      <PageHeader mode={d.modes.solar} title="Solar" subtitle="SOFAR inverter · production, battery and grid · pushed every few minutes by Home Assistant or a small bridge script">
        {d.modes.solar === "live" && <Tag color="#3df5a0">● Live</Tag>}
        {night && <Tag color="#a98bff">☾ Night · {pad(cfg.daylightFrom)}–{pad(cfg.daylightTo)} daylight</Tag>}
      </PageHeader>

      {d.modes.solar !== "live" && (
        <Card className="mb-5">
          <p className="text-sm">
            {samplesEnabled() ? "Showing a sample system. " : "No solar readings yet. "}Create an ingest token in <Link href="/settings#solar" className="text-cyan hover:underline">Settings → Solar</Link>, then have Home Assistant (SOFAR or Solarman integration) post readings to <code className="font-mono text-xs text-[#9be7ff]">/api/ingest/solar</code>; the README has a copy-paste config. Direct sync with the Fsolar cloud is ready to add once SOFAR grants your account API access.
          </p>
        </Card>
      )}
      {d.modes.solar === "live" && stations.length === 0 && <Card className="mb-5"><p className="py-6 text-center text-sm text-muted">Waiting for the first reading. Check that your bridge is sending to /api/ingest/solar with the token.</p></Card>}

      {stations.map((s) => {
        const r = s.latest;
        const det = s.detail;
        const flow = energyFlow(r);
        const problem = r.status === "fault" || r.alarms.length > 0;
        const low = r.batterySoc !== null && r.batterySoc < cfg.lowBatteryPct;
        const stale = (now.getTime() - Date.parse(r.at)) / 60_000 > cfg.offlineAfterMin;
        const solarCurve = s.todayCurve.map((p) => ({ h: hourOfDay(p.at, tz), w: p.powerW }));
        const loadCurve = (det?.loadCurve ?? []).map((p) => ({ h: hourOfDay(p.at, tz), w: p.loadW }));
        const avg = s.daily.length ? s.daily.reduce((a, x) => a + x.value, 0) / s.daily.length : 0;
        return (
          <section key={s.station} className="mb-8">
            <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
              <h2 className="font-display text-lg font-semibold uppercase tracking-[0.14em]">{s.station}</h2>
              <BizLabel name={s.business} className="text-sm" />
              <Tag color={STATUS_COLOR[r.status]}>{r.status === "fault" && <SeverityIcon severity="critical" size={12} />}{r.status}</Tag>
              <span className={`text-xs ${stale && !night ? "text-high" : "text-muted"}`}>last reading {timeAgo(r.at)}</span>
            </div>

            {problem && (
              <div className="hud-panel mb-5 flex items-start gap-3 p-4" style={{ "--a": "#ff3d6e" } as CSSProperties}>
                <SeverityIcon severity={r.status === "fault" ? "critical" : "high"} />
                <div>
                  <div className={`hud-label text-[11px] ${r.status === "fault" ? "text-critical" : "text-high"}`}>{r.status === "fault" ? "Critical · inverter fault" : "High · inverter alarm"}</div>
                  <p className="text-sm">{r.alarms.length ? r.alarms.join(" · ") : "The inverter reports a fault."}</p>
                </div>
              </div>
            )}

            <div className="mb-5 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
              <Stat label="Solar now" value={<span className="inline-flex items-center gap-2"><Sun size={20} className="text-lime" />{watts(r.powerW)}</span>} hint={r.todayKWh !== null ? `${r.todayKWh} kWh today` : undefined} />
              <Stat label="Battery" tone={low ? "high" : "ink"} value={<span className="inline-flex items-center gap-2"><BatteryCharging size={20} className={low ? "text-high" : "text-emerald"} />{r.batterySoc === null ? "—" : `${Math.round(r.batterySoc)}%`}</span>} hint={r.batteryW !== null ? `${watts(r.batteryW)} · ${flow.battery.word}${low ? " · low" : ""}` : undefined} />
              <Stat label={flow.grid.dir === "out" ? "Grid export" : "Grid import"} value={<span className="inline-flex items-center gap-2"><PlugZap size={20} className="text-cyan" />{watts(r.gridW === null ? null : Math.abs(r.gridW))}</span>} hint={flow.grid.word} />
              <Stat label="Home use" value={<span className="inline-flex items-center gap-2"><Home size={20} className="text-gold" />{watts(r.loadW)}</span>} hint={r.totalKWh !== null ? `${r.totalKWh.toLocaleString("en-US")} kWh lifetime` : undefined} />
            </div>

            <div className="mb-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
              <Card title="Battery reserve" action={r.batteryW !== null ? flow.battery.word : undefined}>
                <BatteryRing soc={r.batterySoc} low={low} />
                <div className="mt-4">
                  <Kv label="Battery power">{watts(r.batteryW)}</Kv>
                  <Kv label="Charged to 100% today">{det?.fullAt ? hm(det.fullAt, tz) : "not yet"}</Kv>
                  <Kv label="Low-battery alert below">{cfg.lowBatteryPct}%</Kv>
                  {det?.socLow && <Kv label="Lowest, last 24 h" valueClass={det.socLow.pct < cfg.lowBatteryPct ? "text-high" : ""}>{Math.round(det.socLow.pct)}% · {hm(det.socLow.at, tz)}</Kv>}
                </div>
              </Card>
              <Card title="Energy flow · now" action={`as of ${hm(r.at, tz)}`}>
                <EnergyFlow flow={flow} inverter={{ word: r.status === "fault" ? "Fault" : r.status[0].toUpperCase() + r.status.slice(1), problem: r.status === "fault" }} />
                <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[12.5px] text-muted">
                  <span><i className="mr-1.5 inline-block h-0.5 w-3 bg-lime align-middle" />Solar {flow.solar.word}{night && flow.solar.dir === "idle" ? " (night)" : ""}</span>
                  <span><i className="mr-1.5 inline-block h-0.5 w-3 bg-emerald align-middle" />Battery {flow.battery.word}</span>
                  <span><i className="mr-1.5 inline-block h-0.5 w-3 bg-cyan align-middle" />Grid {flow.grid.word}</span>
                  <span><i className="mr-1.5 inline-block h-0.5 w-3 bg-gold align-middle" />Home {flow.home.word}</span>
                </div>
              </Card>
            </div>

            <div className="mb-5 grid gap-5 lg:grid-cols-2">
              <Card title="Production today" action={det?.peak ? `peak ${watts(det.peak.powerW)} · ${hm(det.peak.at, tz)}` : undefined}>
                {solarCurve.length > 1 ? (
                  <>
                    <ProductionChart solar={solarCurve} load={loadCurve} nowH={nowH} />
                    <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[12.5px] text-muted">
                      <span><i className="mr-1.5 inline-block h-0.5 w-3 bg-lime align-middle" />Solar power</span>
                      {loadCurve.length > 1 && <span><i className="mr-1.5 inline-block h-0.5 w-3 bg-gold align-middle" />Home use</span>}
                      {r.todayKWh !== null && <span className="font-mono tabular-nums">{r.todayKWh} kWh produced</span>}
                    </div>
                  </>
                ) : <p className="py-8 text-center text-sm text-muted">Not enough readings today yet.</p>}
              </Card>
              <Card title="Energy per day" action={s.daily.length > 1 ? `last ${s.daily.length} days · avg ${avg.toFixed(1)} kWh` : undefined}>
                {s.daily.length > 1 ? (
                  <>
                    <DailyBars days={s.daily.map((x) => ({ ...x, label: shortDay(x.date) }))} />
                    <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[12.5px] text-muted">
                      <span><i className="mr-1.5 inline-block h-2 w-3 bg-lime align-middle" />kWh per day</span>
                      <span><i className="mr-1.5 inline-block h-0 w-3 border-t border-dashed border-ink/60 align-middle" />{s.daily.length}-day average</span>
                      <span className="font-mono tabular-nums">total {Math.round(s.daily.reduce((a, x) => a + x.value, 0))} kWh</span>
                    </div>
                  </>
                ) : <p className="py-8 text-center text-sm text-muted">Builds up as readings arrive.</p>}
              </Card>
            </div>

            <Card title="Inverter · alarms" action="pushed readings">
              <div className="grid gap-x-8 sm:grid-cols-3">
                <div>
                  <Kv label="Status" valueClass={r.status === "fault" ? "text-critical" : r.status === "normal" ? "text-emerald" : ""}>{r.status}</Kv>
                  <Kv label="Alarms" valueClass={r.alarms.length ? "text-high" : ""}>{r.alarms.length ? `${r.alarms.length} active` : "none"}</Kv>
                </div>
                <div>
                  <Kv label="Last reading">{hm(r.at, tz)} · {timeAgo(r.at)}</Kv>
                  <Kv label="Offline after">{cfg.offlineAfterMin} min silent</Kv>
                </div>
                <div>
                  {det && <Kv label="Readings today">{det.readingsToday}</Kv>}
                  <Kv label="Expected daylight">{pad(cfg.daylightFrom)} – {pad(cfg.daylightTo)}</Kv>
                </div>
              </div>
            </Card>
          </section>
        );
      })}
    </>
  );
}
