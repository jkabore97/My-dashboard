import type { SourceResult } from "./types";

const REVALIDATE_SECONDS = 120;

// Runs a live fetcher when credentials exist, otherwise serves demo data.
// A failing live fetch also falls back to demo data but is flagged as an error
// so the UI can show that a connector is broken rather than silently stale.
// A fetcher that loses only part of its data reports it through `fail`; the
// result stays live but lists those parts so their tasks aren't auto-closed.
/**
 * Sample data for platforms that aren't connected. Off in production (an
 * unconnected section is simply empty), on in development and tests.
 * SAMPLE_DATA=on or off overrides either way.
 */
export function samplesEnabled() {
  const v = process.env.SAMPLE_DATA?.trim().toLowerCase();
  if (v === "on" || v === "true") return true;
  if (v === "off" || v === "false") return false;
  return process.env.NODE_ENV !== "production";
}

/** The same shape with nothing in it: lists empty, nested objects emptied, other values null. */
export function emptyLike<T>(v: T): T {
  if (Array.isArray(v)) return [] as T;
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, Array.isArray(x) ? [] : x && typeof x === "object" ? emptyLike(x) : null])) as T;
  }
  return v;
}

export async function fromSource<T>(
  source: string,
  configured: boolean,
  live: (fail: (key: string, error: string) => void) => Promise<T>,
  demo: () => T,
): Promise<SourceResult<T>> {
  const fetchedAt = new Date().toISOString();
  const fallback = () => (samplesEnabled() ? demo() : emptyLike(demo()));
  if (!configured) return { source, mode: "demo", data: fallback(), fetchedAt };
  const partial: { key: string; error: string }[] = [];
  try {
    const data = await live((key, error) => partial.push({ key, error }));
    return { source, mode: "live", data, fetchedAt, ...(partial.length ? { partial } : {}) };
  } catch (err) {
    return { source, mode: "error", data: fallback(), error: errorMessage(err), fetchedAt };
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

/** An abort signal for one outbound call: `ms` at most, and never past `outer` (a whole job's deadline). */
export const callSignal = (ms = 10_000, outer?: AbortSignal) => (outer ? AbortSignal.any([outer, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms));
