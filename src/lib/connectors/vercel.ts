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

export async function getVercelProjects(rules: BusinessRule[]) {
  const creds = await vercelCreds();
  return fromSource<HostingProject[]>(
    "Vercel",
    !!creds,
    async () => {
      const { projects } = await getJson<{ projects: VercelProject[] }>(
        `https://api.vercel.com/v9/projects?limit=100${creds!.teamId ? `&teamId=${encodeURIComponent(creds!.teamId)}` : ""}`,
        { headers: { Authorization: `Bearer ${creds!.token}` } },
      );
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
        };
      });
    },
    () => demoHosting().filter((h) => h.provider === "vercel"),
  );
}
