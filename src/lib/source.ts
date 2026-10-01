import type { SourceResult } from "./types";

const REVALIDATE_SECONDS = 120;

// Runs a live fetcher when credentials exist, otherwise serves demo data.
// A failing live fetch also falls back to demo data but is flagged as an error
// so the UI can show that a connector is broken rather than silently stale.
// A fetcher that loses only part of its data reports it through `fail`; the
// result stays live but lists those parts so their tasks aren't auto-closed.
export async function fromSource<T>(
  source: string,
  configured: boolean,
  live: (fail: (key: string, error: string) => void) => Promise<T>,
  demo: () => T,
): Promise<SourceResult<T>> {
  const fetchedAt = new Date().toISOString();
  if (!configured) return { source, mode: "demo", data: demo(), fetchedAt };
  const partial: { key: string; error: string }[] = [];
  try {
    const data = await live((key, error) => partial.push({ key, error }));
    return { source, mode: "live", data, fetchedAt, ...(partial.length ? { partial } : {}) };
  } catch (err) {
    return { source, mode: "error", data: demo(), error: errorMessage(err), fetchedAt };
  }
}

export const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

export async function getJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, init.cache ? init : { ...init, next: { revalidate: REVALIDATE_SECONDS } });
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
