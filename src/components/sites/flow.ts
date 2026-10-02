import type { SolarReading } from "@/lib/solar";

// Pure: the latest reading → what the energy-flow diagram draws. Each link
// runs between a node and the inverter; "in" means toward the inverter.

export type FlowDir = "in" | "out" | "idle" | "unknown";
export interface FlowLink { watts: number | null; dir: FlowDir; word: string }
export interface Flow { solar: FlowLink; battery: FlowLink; grid: FlowLink; home: FlowLink }

/** Below this many watts a link counts as idle (sensor noise). */
export const FLOW_IDLE_W = 20;

const link = (w: number | null, inWord: string, outWord: string, positiveIsIn: boolean): FlowLink => {
  if (w === null) return { watts: null, dir: "unknown", word: "no reading" };
  if (Math.abs(w) < FLOW_IDLE_W) return { watts: w, dir: "idle", word: "idle" };
  const isIn = positiveIsIn ? w > 0 : w < 0;
  return { watts: w, dir: isIn ? "in" : "out", word: isIn ? inWord : outWord };
};

export function energyFlow(r: Pick<SolarReading, "powerW" | "batteryW" | "gridW" | "loadW">): Flow {
  return {
    solar: link(r.powerW, "producing", "producing", true),
    // batteryW: positive = charging (energy flows out of the inverter into the battery).
    battery: link(r.batteryW, "discharging", "charging", false),
    // gridW: positive = importing (flows into the inverter).
    grid: link(r.gridW, "importing", "exporting", true),
    home: link(r.loadW, "using", "using", false),
  };
}

export const watts = (w: number | null) => (w === null ? "—" : Math.abs(w) >= 1000 ? `${(w / 1000).toFixed(1)} kW` : `${Math.round(w)} W`);
