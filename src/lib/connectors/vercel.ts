import { demoHosting } from "../demo";
import { businessFor, env, fromSource, getJson } from "../source";
import type { DeployState, HostingProject } from "../types";

interface VercelProject {
  id: string;
  name: string;
  framework: string | null;
  link?: { repo?: string };
  alias?: { domain: string }[];
  targets?: { production?: { alias?: string[]; readyState?: string; createdAt?: number } };
  latestDeployments?: { readyState?: string; createdAt?: number; url?: string }[];
}

function mapState(s?: string): DeployState | null {
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

export function getVercelProjects() {
  const team = env("VERCEL_TEAM_ID");
  return fromSource<HostingProject[]>(
    "Vercel",
    !!env("VERCEL_TOKEN"),
    async () => {
      const { projects } = await getJson<{ projects: VercelProject[] }>(
        `https://api.vercel.com/v9/projects?limit=100${team ? `&teamId=${team}` : ""}`,
        { headers: { Authorization: `Bearer ${env("VERCEL_TOKEN")}` } },
      );
      return projects.map((p) => {
        const prod = p.targets?.production;
        const latest = p.latestDeployments?.[0];
        const domain = prod?.alias?.find((a) => !a.endsWith(".vercel.app")) ?? prod?.alias?.[0] ?? latest?.url;
        return {
          id: p.id,
          name: p.name,
          provider: "vercel" as const,
          url: domain ? `https://${domain}` : null,
          framework: p.framework,
          lastDeployState: mapState(prod?.readyState ?? latest?.readyState),
          lastDeployAt: (prod?.createdAt ?? latest?.createdAt) ? new Date((prod?.createdAt ?? latest?.createdAt)!).toISOString() : null,
          repo: p.link?.repo,
          business: businessFor(p.name),
        };
      });
    },
    () => demoHosting().filter((h) => h.provider === "vercel"),
  );
}
