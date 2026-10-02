import { demoSolarReadings } from "../demo";
import { businessTimeZone } from "../dates";
import { buildStations, type SolarStation } from "../solar";
import { fromSource } from "../source";
import type { SourceResult } from "../types";
import { ingestConfigured, loadReadings, solarConfig, type SolarConfig } from "../server/solar-store";

/** Solar systems from pushed readings; demo until an ingest token exists or a reading arrives. */
export async function getSolar(): Promise<{ result: SourceResult<SolarStation[]>; config: SolarConfig }> {
  const tz = businessTimeZone();
  const [config, readings, configured] = await Promise.all([solarConfig(), loadReadings().catch(() => null), ingestConfigured().catch(() => false)]);
  const result = await fromSource<SolarStation[]>(
    "Solar",
    configured || (readings?.length ?? 0) > 0,
    async () => {
      if (!readings) throw new Error("Couldn't read stored solar readings");
      return buildStations(readings, config.businesses, tz);
    },
    () => buildStations(demoSolarReadings(), { home: "Home" }, tz),
  );
  return { result, config };
}
