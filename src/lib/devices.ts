import type { CameraSiteStatus } from "./connectors/hikvision";
import { deriveSolarTasks, type SolarSettings, type SolarStation } from "./solar";
import type { SourceMode, Task } from "./types";

// Phase 4 rules: cameras (Hikvision NVRs) and solar systems → tasks. Pure,
// like risk.ts and growth.ts; collect() feeds it and persist() stores it.

export type DeviceScope = "cameras" | "solar";

export interface DeviceTask extends Task {
  scope: DeviceScope;
  live: boolean;
}

/** Disk states Hikvision reports for a healthy, usable disk. */
export const HEALTHY_DISK = new Set(["ok", "normal", "idle", "sleeping", "formatting"]);

export interface DeviceInput {
  cameras: CameraSiteStatus[];
  solar: SolarStation[];
  solarSettings: SolarSettings;
  timeZone: string;
  modes: Record<DeviceScope, SourceMode>;
  /** Camera sites that couldn't be reached this round. */
  partial: { cameras: string[] };
  now?: Date;
}

export function deriveDeviceTasks(d: DeviceInput): { tasks: DeviceTask[]; unobserved: string[] } {
  const now = d.now ?? new Date();
  const at = now.toISOString();
  const tasks: DeviceTask[] = [];
  const add = (scope: DeviceScope, key: string, t: Omit<Task, "id">) => tasks.push({ ...t, id: `${scope}/${key}`, scope, live: d.modes[scope] === "live" });

  for (const site of d.cameras) {
    const business = site.business ?? undefined;
    const offline = site.channels.filter((c) => c.online === false);
    if (offline.length) {
      add("cameras", `${site.id}:offline`, {
        title: `${offline.length} camera${offline.length > 1 ? "s" : ""} offline at ${site.label}`,
        detail: offline.map((c) => c.name).join(", "),
        severity: "high",
        source: "Cameras",
        url: "/cameras",
        createdAt: at,
        business,
      });
    }
    for (const disk of site.disks) {
      if (HEALTHY_DISK.has(disk.status)) continue;
      add("cameras", `${site.id}:disk:${disk.id}`, {
        title: `Recorder disk problem at ${site.label}: ${disk.name} is ${disk.status}`,
        detail: "Recording may have stopped. Check the disk in the NVR (Storage → HDD Management) and replace it if it reports errors.",
        severity: "critical",
        source: "Cameras",
        url: "/cameras",
        createdAt: at,
        business,
      });
    }
    if (site.disks.length === 0 && site.channels.length > 0 && site.device.model && !/^DS-2C|^DS-2D/i.test(site.device.model)) {
      // An NVR with no disk records nothing. Standalone cameras (DS-2C…/DS-2D…) may record to SD or not at all.
      add("cameras", `${site.id}:no-disk`, { title: `No recording disk found at ${site.label}`, detail: "The NVR reports no hard disk, so nothing is being recorded.", severity: "critical", source: "Cameras", url: "/cameras", createdAt: at, business });
    }
  }

  for (const t of deriveSolarTasks(d.solar, d.solarSettings, d.timeZone, now)) {
    const { key, ...rest } = t;
    add("solar", key, rest);
  }

  return { tasks, unobserved: d.partial.cameras.map((id) => `cameras/${id}:`) };
}
