import { demoSolarReadings } from "../demo";
import { businessTimeZone, today } from "../dates";
import { buildStations, type SolarReading, type SolarStation } from "../solar";
import { fromSource } from "../source";
import type { SourceResult } from "../types";
import { ingestConfigured, loadReadings, solarConfig, type SolarConfig } from "../server/solar-store";

/** Extra per-station detail for the Solar page, computed from the same stored readings (JSON-safe). */
export interface SolarStationDetail {
  /** Home use today, one point per reading that reported it (W). */
  loadCurve: { at: string; loadW: number }[];
  /** Readings received today (business time zone). */
  readingsToday: number;
  /** Lowest battery charge in the last 24 hours, when the battery reports it. */
  socLow: { pct: number; at: string } | null;
  /** First time the battery reached 100% today. */
  fullAt: string | null;
  /** Peak production today. */
  peak: { at: string; powerW: number } | null;
}

export type SolarStationView = SolarStation & { detail?: SolarStationDetail };

/** Pure: one station's readings (any order) → the extra detail the page shows. */
export function stationDetail(readings: SolarReading[], station: string, tz: string, now = new Date()): SolarStationDetail {
  const rs = readings.filter((r) => r.station === station && Date.parse(r.at) <= now.getTime() + 5 * 60_000).sort((a, b) => a.at.localeCompare(b.at));
  const day = today(tz, now);
  const todays = rs.filter((r) => today(tz, new Date(r.at)) === day);
  const lastDay = rs.filter((r) => Date.parse(r.at) > now.getTime() - 86_400_000 && r.batterySoc !== null);
  let socLow: SolarStationDetail["socLow"] = null;
  for (const r of lastDay) if (!socLow || r.batterySoc! < socLow.pct) socLow = { pct: r.batterySoc!, at: r.at };
  let peak: SolarStationDetail["peak"] = null;
  for (const r of todays) if (r.powerW !== null && r.powerW > 0 && (!peak || r.powerW > peak.powerW)) peak = { at: r.at, powerW: r.powerW };
  return {
    loadCurve: todays.filter((r) => r.loadW !== null).map((r) => ({ at: r.at, loadW: r.loadW! })),
    readingsToday: new Set(todays.map((r) => r.at)).size,
    socLow,
    fullAt: todays.find((r) => r.batterySoc !== null && r.batterySoc >= 100)?.at ?? null,
    peak,
  };
}

function withDetail(stations: SolarStation[], readings: SolarReading[], tz: string): SolarStationView[] {
  return stations.map((s) => ({ ...s, detail: stationDetail(readings, s.station, tz) }));
}

/** Solar systems from pushed readings; demo until an ingest token exists or a reading arrives. */
export async function getSolar(): Promise<{ result: SourceResult<SolarStation[]>; config: SolarConfig }> {
  const tz = businessTimeZone();
  const [config, readings, configured] = await Promise.all([solarConfig(), loadReadings().catch(() => null), ingestConfigured().catch(() => false)]);
  const result = await fromSource<SolarStation[]>(
    "Solar",
    configured || (readings?.length ?? 0) > 0,
    async () => {
      if (!readings) throw new Error("Couldn't read stored solar readings");
      return withDetail(buildStations(readings, config.businesses, tz), readings, tz);
    },
    () => {
      const demo = demoSolarReadings();
      return withDetail(buildStations(demo, { home: "Home" }, tz), demo, tz);
    },
  );
  return { result, config };
}
