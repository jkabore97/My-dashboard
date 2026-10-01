import { demoWebsites } from "../demo";
import { env, fromSource } from "../source";
import type { HostingProject, Website } from "../types";
import { countAuthUsers } from "./supabase";

// WEBSITES="kajconsulting.com|Kaj Consulting|<supabase-project-ref>;shop.com|Kaj Store"
// The Supabase ref is optional; when present, sign-up counts come from auth.users.
function configuredSites() {
  return (env("WEBSITES") ?? "")
    .split(";")
    .map((entry) => entry.split("|").map((s) => s.trim()))
    .filter(([domain]) => !!domain)
    .map(([domain, business, supabaseRef]) => ({ domain, business: business || "Unassigned", supabaseRef }));
}

async function probe(domain: string): Promise<Pick<Website, "status" | "responseMs">> {
  const started = Date.now();
  try {
    const res = await fetch(`https://${domain}`, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    const ms = Date.now() - started;
    if (res.status >= 500) return { status: "down", responseMs: ms };
    return { status: ms > 1200 || res.status >= 400 ? "degraded" : "up", responseMs: ms };
  } catch {
    return { status: "down", responseMs: null };
  }
}

export function getWebsites(hosting: HostingProject[]) {
  const sites = configuredSites();
  return fromSource<Website[]>(
    "Websites",
    sites.length > 0,
    async () =>
      Promise.all(
        sites.map(async (s, i) => {
          const [health, users] = await Promise.all([
            probe(s.domain),
            s.supabaseRef ? countAuthUsers(s.supabaseRef) : Promise.resolve(null),
          ]);
          const host = hosting.find((h) => h.url?.includes(s.domain));
          return {
            id: `site-${i}`,
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
