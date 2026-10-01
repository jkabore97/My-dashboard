import { demoDatabases, demoHosting } from "../demo";
import { businessFor, env, fromSource, getJson } from "../source";
import type { Database, HostingProject } from "../types";

const configured = () => !!(env("CLOUDFLARE_API_TOKEN") && env("CLOUDFLARE_ACCOUNT_ID"));

function cf<T>(path: string) {
  return getJson<{ result: T }>(
    `https://api.cloudflare.com/client/v4/accounts/${env("CLOUDFLARE_ACCOUNT_ID")}${path}`,
    { headers: { Authorization: `Bearer ${env("CLOUDFLARE_API_TOKEN")}` } },
  ).then((r) => r.result);
}

export function getCloudflareWorkers() {
  return fromSource<HostingProject[]>(
    "Cloudflare",
    configured(),
    async () => {
      const scripts = await cf<{ id: string; modified_on: string }[]>("/workers/scripts");
      return scripts.map((s) => ({
        id: `cf-${s.id}`,
        name: s.id,
        provider: "cloudflare" as const,
        url: null,
        framework: "workers",
        lastDeployState: "ready" as const,
        lastDeployAt: s.modified_on,
        business: businessFor(s.id),
      }));
    },
    () => demoHosting().filter((h) => h.provider === "cloudflare"),
  );
}

export function getCloudflareD1() {
  return fromSource<Database[]>(
    "Cloudflare",
    configured(),
    async () => {
      const dbs = await cf<{ uuid: string; name: string; created_at: string }[]>("/d1/database");
      return dbs.map((d) => ({
        id: d.uuid,
        name: d.name,
        provider: "cloudflare-d1" as const,
        region: null,
        status: "healthy" as const,
        createdAt: d.created_at,
        business: businessFor(d.name),
      }));
    },
    () => demoDatabases().filter((d) => d.provider === "cloudflare-d1"),
  );
}
