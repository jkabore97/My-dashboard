import type { SourceResult } from "./types";

const REVALIDATE_SECONDS = 120;

// Runs a live fetcher when credentials exist, otherwise serves demo data.
// A failing live fetch also falls back to demo data but is flagged as an error
// so the UI can show that a connector is broken rather than silently stale.
export async function fromSource<T>(
  source: string,
  configured: boolean,
  live: () => Promise<T>,
  demo: () => T,
): Promise<SourceResult<T>> {
  const fetchedAt = new Date().toISOString();
  if (!configured) return { source, mode: "demo", data: demo(), fetchedAt };
  try {
    return { source, mode: "live", data: await live(), fetchedAt };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { source, mode: "error", data: demo(), error, fetchedAt };
  }
}

export async function getJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, { ...init, next: { revalidate: REVALIDATE_SECONDS } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText} from ${new URL(url).host}${body ? `: ${body.slice(0, 160)}` : ""}`);
  }
  return res.json() as Promise<T>;
}

export function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

// BUSINESS_MAP="repo-or-project-name=Business Name,other=Other Biz" lets one
// dashboard group resources across several companies.
export function businessFor(name: string): string | undefined {
  const raw = env("BUSINESS_MAP");
  if (!raw) return undefined;
  for (const pair of raw.split(",")) {
    const [key, value] = pair.split("=").map((s) => s.trim());
    if (key && value && name.toLowerCase().includes(key.toLowerCase())) return value;
  }
  return undefined;
}
