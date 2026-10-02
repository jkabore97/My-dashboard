import { today } from "./dates";
import type { Severity, Task } from "./types";

// Solar systems (SOFAR inverters and others). Readings are pushed to
// /api/ingest/solar by whatever can read the inverter: Home Assistant (SOFAR /
// SOLARMAN integrations), a small script on the local network, or the Fsolar
// API once SOFAR grants access. Every reading is stored as a snapshot.

export interface SolarReading {
  /** Stable id for the system ("home", "office-roof"…). */
  station: string;
  at: string;
  /** Current PV production, watts. */
  powerW: number | null;
  /** Energy produced today, kWh. */
  todayKWh: number | null;
  /** Lifetime production, kWh. */
  totalKWh: number | null;
  /** Battery state of charge, 0–100. */
  batterySoc: number | null;
  /** Battery power, watts: positive = charging, negative = discharging. */
  batteryW: number | null;
  /** Grid power, watts: positive = importing, negative = exporting. */
  gridW: number | null;
  /** Home consumption, watts. */
  loadW: number | null;
  status: "normal" | "fault" | "standby" | "offline" | "unknown";
  alarms: string[];
}

const STATION = /^[a-z0-9][a-z0-9_-]{0,39}$/;

function finite(v: unknown, min: number, max: number): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

/** Validates a pushed reading. Returns the reading or an error message. */
export function parseReading(body: unknown, now = new Date()): SolarReading | string {
  if (!body || typeof body !== "object") return "Body must be a JSON object";
  const b = body as Record<string, unknown>;
  const station = String(b.station ?? "").trim().toLowerCase();
  if (!STATION.test(station)) return 'station must be a short id like "home" (letters, numbers, - or _)';
  let at = now.toISOString();
  if (b.at !== undefined) {
    const t = Date.parse(String(b.at));
    if (Number.isNaN(t)) return "at must be an ISO timestamp";
    if (t > now.getTime() + 5 * 60_000 || t < now.getTime() - 7 * 86_400_000) return "at must be within the last 7 days";
    at = new Date(t).toISOString();
  }
  const status = String(b.status ?? "unknown").toLowerCase();
  const alarms = Array.isArray(b.alarms) ? b.alarms.map((a) => String(a).slice(0, 120)).filter(Boolean).slice(0, 10) : [];
  return {
    station,
    at,
    powerW: finite(b.powerW, 0, 10_000_000),
    todayKWh: finite(b.todayKWh, 0, 1_000_000),
    totalKWh: finite(b.totalKWh, 0, 1_000_000_000),
    batterySoc: finite(b.batterySoc, 0, 100),
    batteryW: finite(b.batteryW, -10_000_000, 10_000_000),
    gridW: finite(b.gridW, -10_000_000, 10_000_000),
    loadW: finite(b.loadW, 0, 10_000_000),
    status: (["normal", "fault", "standby", "offline"].includes(status) ? status : "unknown") as SolarReading["status"],
    alarms,
  };
}

export interface SolarStation {
  station: string;
  business: string | null;
  latest: SolarReading;
  /** Production today, one point per reading (power in W). */
  todayCurve: { at: string; powerW: number }[];
  /** Energy per day for the last 14 days (max todayKWh seen each day). */
  daily: { date: string; value: number }[];
}

export interface SolarSettings {
  /** Hours (business timezone) when the inverter should be reporting. */
  daylightFrom: number;
  daylightTo: number;
  /** Minutes without a reading during daylight before it's "offline". */
  offlineAfterMin: number;
  lowBatteryPct: number;
}

export const DEFAULT_SOLAR_SETTINGS: SolarSettings = { daylightFrom: 7, daylightTo: 17, offlineAfterMin: 30, lowBatteryPct: 15 };

export function hourIn(tz: string, now = new Date()) {
  try {
    return Number(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hourCycle: "h23" }).format(now));
  } catch {
    return now.getUTCHours();
  }
}

export function isDaylight(s: SolarSettings, tz: string, now = new Date()) {
  const h = hourIn(tz, now);
  return h >= s.daylightFrom && h < s.daylightTo;
}

/**
 * Pure: stations → tasks (offline in daylight, faults/alarms, low battery).
 * Outside daylight "offline" can't be judged, so the caller leaves an
 * existing offline task as it is (see devices.ts) instead of closing it.
 */
export function deriveSolarTasks(stations: SolarStation[], s: SolarSettings, tz: string, now = new Date()): (Omit<Task, "id"> & { key: string })[] {
  const out: (Omit<Task, "id"> & { key: string })[] = [];
  const daylight = isDaylight(s, tz, now);
  for (const st of stations) {
    const r = st.latest;
    const silentMin = (now.getTime() - Date.parse(r.at)) / 60_000;
    const business = st.business ?? undefined;
    if (daylight && (silentMin > s.offlineAfterMin || r.status === "offline")) {
      out.push({ key: `${st.station}:offline`, title: `Solar system "${st.station}" stopped reporting`, detail: `No reading for ${Math.round(silentMin)} minutes during daylight. Check the inverter, its Wi-Fi logger, and the bridge that sends readings.`, severity: "high", source: "Solar", url: "/solar", createdAt: r.at, business });
    }
    if (r.status === "fault" || r.alarms.length) {
      const sev: Severity = r.status === "fault" ? "critical" : "high";
      out.push({ key: `${st.station}:fault`, title: `Inverter ${r.status === "fault" ? "fault" : "alarm"} on "${st.station}"`, detail: r.alarms.length ? r.alarms.join(" · ") : "The inverter reports a fault state.", severity: sev, source: "Solar", url: "/solar", createdAt: r.at, business });
    }
    if (r.batterySoc !== null && r.batterySoc < s.lowBatteryPct && silentMin < 60) {
      out.push({ key: `${st.station}:battery-low`, title: `Battery low on "${st.station}" (${Math.round(r.batterySoc)}%)`, detail: "Running on battery with little charge left; expect grid import or a shutdown of backed-up circuits.", severity: "medium", source: "Solar", url: "/solar", createdAt: r.at, business });
    }
  }
  return out;
}

/** Pure: raw readings (any order, duplicates allowed) → per-station view; `latest` is always the newest by time. */
export function buildStations(readings: SolarReading[], businesses: Record<string, string>, tz: string, now = new Date()): SolarStation[] {
  const byStation = new Map<string, SolarReading[]>();
  const seen = new Set<string>();
  for (const r of readings) {
    if (seen.has(`${r.station}|${r.at}`)) continue;
    seen.add(`${r.station}|${r.at}`);
    byStation.set(r.station, [...(byStation.get(r.station) ?? []), r]);
  }
  const day = today(tz, now);
  return [...byStation].map(([station, rs]) => {
    rs.sort((a, b) => a.at.localeCompare(b.at));
    const daily = new Map<string, number>();
    for (const r of rs) if (r.todayKWh !== null) { const d = today(tz, new Date(r.at)); daily.set(d, Math.max(daily.get(d) ?? 0, r.todayKWh)); }
    return {
      station,
      business: businesses[station] ?? null,
      latest: rs[rs.length - 1],
      todayCurve: rs.filter((r) => r.powerW !== null && today(tz, new Date(r.at)) === day).map((r) => ({ at: r.at, powerW: r.powerW! })),
      daily: [...daily].map(([date, value]) => ({ date, value: Math.round(value * 10) / 10 })).sort((a, b) => a.date.localeCompare(b.date)).slice(-14),
    };
  });
}
