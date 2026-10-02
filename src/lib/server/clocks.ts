import { businessTimeZone } from "../dates";
import { env } from "../source";
import type { ClockZone } from "@/components/Clocks";

const valid = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

/** A city name from a zone id: "America/New_York" → "New York". */
const cityOf = (tz: string) => (tz.split("/").pop() ?? tz).replace(/_/g, " ");

/**
 * Clocks in the sidebar: the business time zone first, then CLOCKS
 * ("Label=Zone/Id, …", e.g. "Ouaga=Africa/Ouagadougou").
 */
export function clockZones(): ClockZone[] {
  const home = businessTimeZone();
  const zones: ClockZone[] = home !== "UTC" && valid(home) ? [{ label: cityOf(home), timeZone: home }] : [];
  for (const part of (env("CLOCKS") ?? "").split(",")) {
    const [label, tz] = part.includes("=") ? part.split("=").map((s) => s.trim()) : [cityOf(part.trim()), part.trim()];
    if (tz && valid(tz) && !zones.some((z) => z.timeZone === tz)) zones.push({ label: label || cityOf(tz), timeZone: tz });
  }
  return zones.slice(0, 4);
}
