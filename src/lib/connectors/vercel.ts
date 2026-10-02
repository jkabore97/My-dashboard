import { demoHosting } from "../demo";
import { businessFor, type BusinessRule } from "../server/config";
import { vercelCreds } from "../server/credentials";
import { fromSource, getJson } from "../source";
import type { DeployState, HostingProject } from "../types";

interface VercelProject {
  id: string;
  name: string;
  framework: string | null;
  link?: { repo?: string };
  targets?: { production?: { alias?: string[]; readyState?: string; createdAt?: number } };
  latestDeployments?: { readyState?: string; createdAt?: number; url?: string }[];
}

export function mapVercelState(s?: string): DeployState | null {
  switch (s) {
    case "READY": return "ready";
    case "ERROR": return "error";
    case "BUILDING":
    case "INITIALIZING": return "building";
    case "QUEUED": return "queued";
    case "CANCELED": return "canceled";
    default: return null;
  }
}

interface VercelDeployment {
  projectId?: string;
  created?: number;
  createdAt?: number;
  buildingAt?: number;
  ready?: number;
  state?: string;
  readyState?: string;
}

type RecentDeploy = NonNullable<HostingProject["recentDeploys"]>[number];

/** Production deployments grouped by project, newest first, with build time when Vercel reports both ends. */
export function groupDeployments(deployments: VercelDeployment[]): Map<string, RecentDeploy[]> {
  const out = new Map<string, RecentDeploy[]>();
  for (const d of deployments) {
    const created = d.created ?? d.createdAt;
    if (!d.projectId || typeof created !== "number") continue;
    const buildMs = typeof d.ready === "number" && typeof d.buildingAt === "number" && d.ready >= d.buildingAt ? d.ready - d.buildingAt : null;
    const list = out.get(d.projectId) ?? [];
    list.push({ at: new Date(created).toISOString(), state: mapVercelState(d.readyState ?? d.state), buildMs });
    out.set(d.projectId, list);
  }
  for (const list of out.values()) list.sort((a, b) => b.at.localeCompare(a.at));
  return out;
}

export async function getVercelProjects(rules: BusinessRule[]) {
  const creds = await vercelCreds();
  return fromSource<HostingProject[]>(
    "Vercel",
    !!creds,
    async () => {
      const team = creds!.teamId ? `&teamId=${encodeURIComponent(creds!.teamId)}` : "";
      const auth = { headers: { Authorization: `Bearer ${creds!.token}` } };
      // Rounded to the hour so the request (and its 2-minute cache entry) is reused.
      const since = Math.floor((Date.now() - 24 * 3_600_000) / 3_600_000) * 3_600_000;
      const [{ projects }, deploys] = await Promise.all([
        getJson<{ projects: VercelProject[] }>(`https://api.vercel.com/v9/projects?limit=100${team}`, auth),
        // One call for the whole account's production deploys of the last day (the Hosting timeline).
        getJson<{ deployments: VercelDeployment[] }>(`https://api.vercel.com/v6/deployments?target=production&limit=100&since=${since}${team}`, auth)
          .then((r) => groupDeployments(r.deployments ?? []))
          .catch(() => null),
      ]);
      return projects.map((p) => {
        const prod = p.targets?.production;
        const latest = p.latestDeployments?.[0];
        const domain = prod?.alias?.find((a) => !a.endsWith(".vercel.app")) ?? prod?.alias?.[0] ?? latest?.url;
        const at = prod?.createdAt ?? latest?.createdAt;
        return {
          id: p.id,
          name: p.name,
          provider: "vercel" as const,
          url: domain ? `https://${domain}` : null,
          framework: p.framework,
          lastDeployState: mapVercelState(prod?.readyState ?? latest?.readyState),
          lastDeployAt: at ? new Date(at).toISOString() : null,
          repo: p.link?.repo,
          business: businessFor(p.name, rules),
          // Absent when the history call failed, so the page can't mistake that for "no deploys".
          ...(deploys ? { recentDeploys: deploys.get(p.id) ?? [] } : {}),
        };
      });
    },
    () => demoHosting().filter((h) => h.provider === "vercel"),
  );
}
