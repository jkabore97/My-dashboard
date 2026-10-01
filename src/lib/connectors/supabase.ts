import { demoDatabases } from "../demo";
import { businessFor, type BusinessRule } from "../server/config";
import { supabaseToken } from "../server/credentials";
import { fromSource, getJson } from "../source";
import type { Database, Severity } from "../types";

const API = "https://api.supabase.com/v1";
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

interface SbProject {
  id: string;
  name: string;
  region: string;
  status: string;
  created_at: string;
}

interface SbLint {
  level: "ERROR" | "WARN" | "INFO";
  title: string;
  detail?: string;
}

const LINT_SEVERITY: Record<SbLint["level"], Severity> = { ERROR: "critical", WARN: "medium", INFO: "low" };

function mapStatus(s: string): Database["status"] {
  if (s === "ACTIVE_HEALTHY") return "healthy";
  if (s === "INACTIVE" || s === "PAUSING") return "paused";
  if (s.startsWith("ACTIVE") || s.includes("UNHEALTHY")) return "degraded";
  return "unknown";
}

async function advisories(token: string, ref: string) {
  const kinds = ["security", "performance"] as const;
  const results = await Promise.all(
    kinds.map((k) =>
      getJson<{ lints: SbLint[] }>(`${API}/projects/${ref}/advisors/${k}`, { headers: auth(token) })
        .then((r) => r.lints)
        .catch(() => [] as SbLint[]),
    ),
  );
  return results.flat().map((l) => ({ level: LINT_SEVERITY[l.level] ?? "low", title: l.detail ?? l.title }));
}

export async function getSupabaseProjects(rules: BusinessRule[]) {
  const token = await supabaseToken();
  return fromSource<Database[]>(
    "Supabase",
    !!token,
    async () => {
      const projects = await getJson<SbProject[]>(`${API}/projects`, { headers: auth(token!) });
      return Promise.all(
        projects.map(async (p) => {
          const status = mapStatus(p.status);
          return {
            id: p.id,
            name: p.name,
            provider: "supabase" as const,
            region: p.region,
            status,
            createdAt: p.created_at,
            advisories: status === "paused" ? [] : await advisories(token!, p.id),
            business: businessFor(p.name, rules),
          };
        }),
      );
    },
    () => demoDatabases().filter((d) => d.provider === "supabase"),
  );
}

// Counts sign-ups in a Supabase project's auth.users via the Management API
// query endpoint (a single select). Used for the "Websites & users" view.
export async function countAuthUsers(ref: string): Promise<{ total: number; new7d: number } | null> {
  const token = await supabaseToken();
  if (!token) return null;
  try {
    const res = await fetch(`${API}/projects/${encodeURIComponent(ref)}/database/query`, {
      method: "POST",
      headers: { ...auth(token), "Content-Type": "application/json" },
      body: JSON.stringify({
        query: "select count(*)::int as total, count(*) filter (where created_at > now() - interval '7 days')::int as new7d from auth.users",
      }),
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    const rows = (await res.json()) as { total: number; new7d: number }[];
    return rows[0] ?? null;
  } catch {
    return null;
  }
}
