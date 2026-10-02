import { demoWebsites } from "../demo";
import type { SiteConfig } from "../server/config";
import { fromSource } from "../source";
import type { HostingProject, Website } from "../types";
import { countAuthUsers } from "./supabase";

export async function probe(domain: string): Promise<Pick<Website, "status" | "responseMs">> {
  const started = Date.now();
  try {
    const res = await fetch(`https://${domain}`, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
      headers: { "User-Agent": "KajCommandCenter-Uptime/1.0" },
    });
    const ms = Date.now() - started;
    await res.body?.cancel().catch(() => {});
    if (res.status >= 500) return { status: "down", responseMs: ms };
    return { status: ms > 1200 || res.status >= 400 ? "degraded" : "up", responseMs: ms };
  } catch {
    return { status: "down", responseMs: null };
  }
}

export function getWebsites(sites: SiteConfig[], hosting: HostingProject[]) {
  return fromSource<Website[]>(
    "Websites",
    sites.length > 0,
    async () =>
      Promise.all(
        sites.map(async (s) => {
          const [health, users] = await Promise.all([
            probe(s.domain),
            s.supabaseRef ? countAuthUsers(s.supabaseRef) : Promise.resolve(null),
          ]);
          const host = hosting.find((h) => h.url && new URL(h.url).hostname === s.domain);
          return {
            id: `site-${s.domain}`,
            domain: s.domain,
            business: s.business,
            ...health,
            totalUsers: users?.total ?? null,
            newUsers7d: users?.new7d ?? null,
            visitors7d: null,
            hostingProjectId: host?.id,
          };
        }),
      ),
    demoWebsites,
  );
}
