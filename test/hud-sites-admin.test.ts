import { describe, expect, it } from "vitest";
import { firmwareAdvisory, parseDeviceInfo, parseFirmwareDate } from "@/lib/connectors/hikvision";
import { stationDetail } from "@/lib/connectors/solar";
import { configStatus, PLATFORM_DEFS } from "@/lib/platforms";
import { PATH_SECTION } from "@/lib/access";
import { NAV_GROUPS } from "@/lib/nav";
import { cameraAlarms, diskUsedPct } from "@/components/sites/alarms";
import { energyFlow } from "@/components/sites/flow";
import { overallStatus } from "@/components/sites/portal";
import { initials, roleCoverage, roleSectionLabels } from "@/components/admin/roles";
import type { SolarReading } from "@/lib/solar";
import type { Notification } from "@/lib/types";

describe("Hikvision firmware date and advisory", () => {
  it("reads build dates in both formats and rejects nonsense", () => {
    expect(parseFirmwareDate("build 170823")).toBe("2017-08-23");
    expect(parseFirmwareDate("Build 210230")).toBeNull(); // Feb 30
    expect(parseFirmwareDate("2019-04-01")).toBe("2019-04-01");
    expect(parseFirmwareDate("V4.61.010")).toBeNull();
    expect(parseFirmwareDate(null)).toBeNull();
  });

  it("adds firmwareDate only when the recorder reports one", () => {
    const base = `<DeviceInfo><deviceName>NVR</deviceName><model>DS-7608NI-E2</model><serialNumber>X</serialNumber><firmwareVersion>V3.4.98</firmwareVersion>`;
    expect(parseDeviceInfo(`${base}<firmwareReleasedDate>build 170823</firmwareReleasedDate></DeviceInfo>`).firmwareDate).toBe("2017-08-23");
    expect("firmwareDate" in parseDeviceInfo(`${base}</DeviceInfo>`)).toBe(false);
  });

  it("flags only firmware older than three years, and never without a date", () => {
    const now = new Date("2026-10-02T12:00:00Z");
    const dev = (firmwareDate?: string) => ({ name: null, model: null, serial: null, firmware: "V1", firmwareDate });
    expect(firmwareAdvisory(dev("2017-08-23"), now)).toEqual({ date: "2017-08-23", year: 2017, ageYears: 9 });
    expect(firmwareAdvisory(dev("2024-01-01"), now)).toBeNull();
    expect(firmwareAdvisory(dev(), now)).toBeNull();
    expect(firmwareAdvisory(dev("2030-01-01"), now)).toBeNull();
  });
});

describe("camera alarms", () => {
  const now = new Date("2026-10-02T20:00:00Z");
  const ev = (id: string, at: string, source = "Cameras"): Notification => ({ id, source, title: `t${id}`, at, severity: "low" });
  it("keeps recent camera events, newest first, with a local time or a date", () => {
    const out = cameraAlarms([ev("1", "2026-10-02T19:48:00Z"), ev("2", "2026-09-30T08:00:00Z"), ev("3", "2026-10-02T19:00:00Z", "GitHub"), ev("4", "2026-09-20T08:00:00Z")], "UTC", now);
    expect(out.map((a) => [a.id, a.when])).toEqual([["1", "19:48"], ["2", "Sep 30"]]);
  });
  it("uses the business time zone for today", () => {
    expect(cameraAlarms([ev("1", "2026-10-02T03:00:00Z")], "America/New_York", now)[0].when).toBe("Oct 1");
  });
  it("computes disk usage only from sane sizes", () => {
    expect(diskUsedPct(2000, 120)).toBe(94);
    expect(diskUsedPct(null, 10)).toBeNull();
    expect(diskUsedPct(100, 200)).toBeNull();
  });
});

describe("solar energy flow and detail", () => {
  it("maps signed readings to directions and words", () => {
    const f = energyFlow({ powerW: 0, batteryW: -600, gridW: 1200, loadW: 600 });
    expect([f.solar.dir, f.battery.dir, f.battery.word, f.grid.word, f.home.dir]).toEqual(["idle", "in", "discharging", "importing", "out"]);
    const g = energyFlow({ powerW: 4000, batteryW: 900, gridW: -300, loadW: null });
    expect([g.solar.dir, g.battery.word, g.grid.word, g.home.dir]).toEqual(["in", "charging", "exporting", "unknown"]);
  });

  it("derives home-use curve, lowest charge, first full charge and peak from stored readings", () => {
    const r = (at: string, p: Partial<SolarReading>): SolarReading => ({ station: "home", at, powerW: null, todayKWh: null, totalKWh: null, batterySoc: null, batteryW: null, gridW: null, loadW: null, status: "normal", alarms: [], ...p });
    const now = new Date("2026-10-02T15:00:00Z");
    const d = stationDetail([
      r("2026-10-01T23:00:00Z", { batterySoc: 55 }),
      r("2026-10-02T06:00:00Z", { batterySoc: 48, loadW: 500 }),
      r("2026-10-02T12:00:00Z", { batterySoc: 100, powerW: 4300, loadW: 700 }),
      r("2026-10-02T13:00:00Z", { batterySoc: 100, powerW: 3900 }),
      { ...r("2026-10-02T13:00:00Z", {}), station: "other", powerW: 9999 },
    ], "home", "UTC", now);
    expect(d.loadCurve.map((p) => p.loadW)).toEqual([500, 700]);
    expect(d.socLow).toEqual({ pct: 48, at: "2026-10-02T06:00:00Z" });
    expect(d.fullAt).toBe("2026-10-02T12:00:00Z");
    expect(d.peak).toEqual({ at: "2026-10-02T12:00:00Z", powerW: 4300 });
    expect(d.readingsToday).toBe(3);
    expect(JSON.parse(JSON.stringify(d))).toEqual(d);
  });
});

describe("config-only platforms", () => {
  it("are on only when every key is set, and never expose values", () => {
    const resend = PLATFORM_DEFS.find((p) => p.id === "resend")!;
    const claude = PLATFORM_DEFS.find((p) => p.id === "claude")!;
    expect(resend.configOnly && claude.configOnly).toBeTruthy();
    expect(configStatus(resend, (k) => k !== "BRIEF_EMAIL_TO").on).toBe(false);
    const on = configStatus(claude, () => true);
    expect(on).toEqual({ on: true, keys: [{ key: "ANTHROPIC_API_KEY", set: true }] });
  });
});

describe("team helpers", () => {
  it("summarizes what each role sees", () => {
    expect(roleCoverage("assistant", ["cameras", "solar"])).toBe("all");
    expect(roleCoverage("accountant", ["money", "reports"])).toBe("all");
    expect(roleCoverage("developer", ["money"])).toBe("none");
    expect(roleCoverage("assistant", ["clients", "money"])).toBe("some");
  });
  it("lists the pages a role opens, once each, in nav order", () => {
    const pages = roleSectionLabels("accountant", NAV_GROUPS, PATH_SECTION);
    expect(pages).toContain("Money");
    expect(pages).not.toContain("Platform spend"); // same section as Money
    expect(pages).not.toContain("Team");
  });
  it("makes initials from names and addresses", () => {
    expect(initials("Awa Sawadogo")).toBe("AS");
    expect(initials("hello@kaj-consulting.com")).toBe("HE");
    expect(initials("jean.paul@x.com")).toBe("JP");
  });
});

describe("client status headline", () => {
  it("is honest about down, slow and unchecked sites", () => {
    expect(overallStatus([{ status: "up", uptime30d: 99.9 }, { status: "up", uptime30d: 100 }])).toMatchObject({ state: "up", title: "All systems operational", uptime30d: 99.95 });
    expect(overallStatus([{ status: "up", uptime30d: 100 }, { status: "down", uptime30d: 90 }]).state).toBe("down");
    expect(overallStatus([{ status: "degraded", uptime30d: null }]).state).toBe("degraded");
    expect(overallStatus([{ status: "unknown", uptime30d: null }])).toMatchObject({ state: "unknown", uptime30d: null });
  });
});
