import { requireSection } from "@/lib/server/auth";
import Link from "next/link";
import { BatteryCharging, Home, PlugZap, Sun } from "lucide-react";
import { getDashboard } from "@/lib/server/dashboard";
import { samplesEnabled } from "@/lib/source";
import { businessTimeZone } from "@/lib/dates";
import { isDaylight } from "@/lib/solar";
import type { SolarStationView } from "@/lib/connectors/solar";
import { BizLabel, Card, Empty, ModePill, PageHeader, SeverityIcon, Stat, SYS, Tag, timeAgo } from "@/components/ui";
import { Kv } from "@/components/sites/bits";
import { energyFlow, watts } from "@/components/sites/flow";
import { BatteryRing, EnergyFlow, FLOW_COLOR } from "@/components/sites/EnergyFlow";
import { DailyBars, HOME_COLOR, ProductionChart, SOLAR_COLOR } from "@/components/sites/SolarCharts";

const STATUS_COLOR = { normal: SYS.green, fault: SYS.red, standby: SYS.gray, offline: SYS.gray, unknown: SYS.gray } as const;
const Swatch = ({ c, bar }: { c: string; bar?: boolean }) => <i className={`mr-1.5 inline-block align-middle ${bar ? "h-2.5 w-2.5 rounded-[3px]" : "h-2 w-2 rounded-full"}`} style={{ background: c }} />;

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
        {d.modes.solar === "live" && <ModePill mode="live" />}
        {night && <Tag color={SYS.indigo}>☾ Night · {pad(cfg.daylightFrom)}–{pad(cfg.daylightTo)} daylight</Tag>}
      </PageHeader>

      {d.modes.solar !== "live" && (
        <div className="mb-5 rounded-[14px] bg-accent/10 px-4 py-3 text-[15px] text-ink">
          <p>
            {samplesEnabled() ? "Showing a sample system. " : "No solar readings yet. "}Create an ingest token in <Link href="/settings#solar" className="text-cyan hover:underline">Settings → Solar</Link>, then have Home Assistant (SOFAR or Solarman integration) post readings to <code className="rounded-md bg-fill px-1.5 font-mono text-[12.5px] text-ink">/api/ingest/solar</code>; the README has a copy-paste config. Direct sync with the Fsolar cloud is ready to add once SOFAR grants your account API access.
          </p>
        </div>
      )}
      {d.modes.solar === "live" && stations.length === 0 && <Card className="mb-5" flush><Empty>Waiting for the first reading. Check that your bridge is sending to /api/ingest/solar with the token.</Empty></Card>}

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
              <h2 className="text-[20px] font-bold tracking-[-0.01em] text-ink">{s.station}</h2>
              <BizLabel name={s.business} />
              <Tag color={STATUS_COLOR[r.status]}>{r.status === "fault" && <SeverityIcon severity="critical" size={12} />}<span className="inline-block first-letter:uppercase">{r.status}</span></Tag>
              <span className={`text-[13px] ${stale && !night ? "text-warn" : "text-muted"}`}>Last reading {timeAgo(r.at)}</span>
            </div>

            {problem && (
              <div className={`mb-5 flex items-start gap-3 rounded-[14px] px-4 py-3 ${r.status === "fault" ? "bg-critical/10" : "bg-high/12"}`}>
                <SeverityIcon severity={r.status === "fault" ? "critical" : "high"} />
                <div>
                  <div className={`text-[13px] font-semibold ${r.status === "fault" ? "text-critical" : "text-warn"}`}>{r.status === "fault" ? "Critical · inverter fault" : "High · inverter alarm"}</div>
                  <p className="text-[15px] text-ink">{r.alarms.length ? r.alarms.join(" · ") : "The inverter reports a fault."}</p>
                </div>
              </div>
            )}

            <div className="mb-5 grid grid-cols-2 gap-2.5 sm:gap-4 md:grid-cols-4">
              <Stat label="Solar now" value={<span className="inline-flex items-center gap-2"><Sun size={20} className="shrink-0 text-gold" />{watts(r.powerW)}</span>} hint={r.todayKWh !== null ? `${r.todayKWh} kWh today` : undefined} />
              <Stat label="Battery" tone={low ? "high" : "ink"} value={<span className="inline-flex items-center gap-2"><BatteryCharging size={20} className={`shrink-0 ${low ? "text-warn" : "text-ok"}`} />{r.batterySoc === null ? "—" : `${Math.round(r.batterySoc)}%`}</span>} hint={r.batteryW !== null ? `${watts(r.batteryW)} · ${flow.battery.word}${low ? " · low" : ""}` : undefined} />
              <Stat label={flow.grid.dir === "out" ? "Grid export" : "Grid import"} value={<span className="inline-flex items-center gap-2"><PlugZap size={20} className="shrink-0 text-cyan" />{watts(r.gridW === null ? null : Math.abs(r.gridW))}</span>} hint={flow.grid.word} />
              <Stat label="Home use" value={<span className="inline-flex items-center gap-2"><Home size={20} className="shrink-0 text-violet" />{watts(r.loadW)}</span>} hint={r.totalKWh !== null ? `${r.totalKWh.toLocaleString("en-US")} kWh lifetime` : undefined} />
            </div>

            <div className="mb-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
              <Card title="Battery reserve" action={r.batteryW !== null ? flow.battery.word : undefined}>
                <BatteryRing soc={r.batterySoc} low={low} />
                <div className="mt-4">
                  <Kv label="Battery power">{watts(r.batteryW)}</Kv>
                  <Kv label="Charged to 100% today">{det?.fullAt ? hm(det.fullAt, tz) : "not yet"}</Kv>
                  <Kv label="Low-battery alert below">{cfg.lowBatteryPct}%</Kv>
                  {det?.socLow && <Kv label="Lowest, last 24 h" valueClass={det.socLow.pct < cfg.lowBatteryPct ? "text-warn" : ""}>{Math.round(det.socLow.pct)}% · {hm(det.socLow.at, tz)}</Kv>}
                </div>
              </Card>
              <Card title="Energy flow · now" action={`as of ${hm(r.at, tz)}`}>
                <EnergyFlow flow={flow} inverter={{ word: r.status === "fault" ? "Fault" : r.status[0].toUpperCase() + r.status.slice(1), problem: r.status === "fault" }} />
                <div className="mt-3 flex flex-wrap justify-center gap-x-5 gap-y-1 text-[13px] text-muted">
                  <span><Swatch c={FLOW_COLOR.solar} />Solar {flow.solar.word}{night && flow.solar.dir === "idle" ? " (night)" : ""}</span>
                  <span><Swatch c={FLOW_COLOR.battery} />Battery {flow.battery.word}</span>
                  <span><Swatch c={FLOW_COLOR.grid} />Grid {flow.grid.word}</span>
                  <span><Swatch c={FLOW_COLOR.home} />Home {flow.home.word}</span>
                </div>
              </Card>
            </div>

            <div className="mb-5 grid gap-5 lg:grid-cols-2">
              <Card title="Production today" action={det?.peak ? `peak ${watts(det.peak.powerW)} · ${hm(det.peak.at, tz)}` : undefined}>
                {solarCurve.length > 1 ? (
                  <>
                    <ProductionChart solar={solarCurve} load={loadCurve} nowH={nowH} />
                    <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-muted">
                      <span><Swatch c={SOLAR_COLOR} />Solar power</span>
                      {loadCurve.length > 1 && <span><Swatch c={HOME_COLOR} />Home use</span>}
                      {r.todayKWh !== null && <span className="tabular-nums">{r.todayKWh} kWh produced</span>}
                    </div>
                  </>
                ) : <Empty>Not enough readings today yet.</Empty>}
              </Card>
              <Card title="Energy per day" action={s.daily.length > 1 ? `last ${s.daily.length} days · avg ${avg.toFixed(1)} kWh` : undefined}>
                {s.daily.length > 1 ? (
                  <>
                    <DailyBars days={s.daily.map((x) => ({ ...x, label: shortDay(x.date) }))} />
                    <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-muted">
                      <span><Swatch c={SOLAR_COLOR} bar />kWh per day</span>
                      <span><i className="mr-1.5 inline-block h-0 w-3 border-t-2 border-dashed border-muted align-middle" />{s.daily.length}-day average</span>
                      <span className="tabular-nums">total {Math.round(s.daily.reduce((a, x) => a + x.value, 0))} kWh</span>
                    </div>
                  </>
                ) : <Empty>Builds up as readings arrive.</Empty>}
              </Card>
            </div>

            <Card title="Inverter and alarms" action="pushed readings">
              <div className="grid gap-x-8 sm:grid-cols-3">
                <div>
                  <Kv label="Status" valueClass={r.status === "fault" ? "text-critical" : r.status === "normal" ? "text-ok" : ""}>{r.status}</Kv>
                  <Kv label="Alarms" valueClass={r.alarms.length ? "text-warn" : ""}>{r.alarms.length ? `${r.alarms.length} active` : "none"}</Kv>
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
