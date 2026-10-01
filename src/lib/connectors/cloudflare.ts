import { demoDatabases, demoHosting } from "../demo";
import { businessFor, type BusinessRule } from "../server/config";
import { cloudflareCreds } from "../server/credentials";
import { fromSource, getJson } from "../source";
import type { Database, HostingProject } from "../types";

type Creds = { token: string; accountId: string };

export function cfGet<T>(creds: Creds, path: string) {
  return getJson<{ result: T }>(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(creds.accountId)}${path}`,
    { headers: { Authorization: `Bearer ${creds.token}` } },
  ).then((r) => r.result);
}

export async function getCloudflareWorkers(rules: BusinessRule[]) {
  const creds = await cloudflareCreds();
  return fromSource<HostingProject[]>(
    "Cloudflare",
    !!creds,
    async () => {
      const scripts = await cfGet<{ id: string; modified_on: string }[]>(creds!, "/workers/scripts");
      return scripts.map((s) => ({
        id: `cf-${s.id}`,
        name: s.id,
        provider: "cloudflare" as const,
        url: null,
        framework: "workers",
        lastDeployState: "ready" as const,
        lastDeployAt: s.modified_on,
        business: businessFor(s.id, rules),
      }));
    },
    () => demoHosting().filter((h) => h.provider === "cloudflare"),
  );
}

export async function getCloudflareD1(rules: BusinessRule[]) {
  const creds = await cloudflareCreds();
  return fromSource<Database[]>(
    "Cloudflare",
    !!creds,
    async () => {
      const dbs = await cfGet<{ uuid: string; name: string; created_at: string }[]>(creds!, "/d1/database");
      return dbs.map((d) => ({
        id: d.uuid,
        name: d.name,
        provider: "cloudflare-d1" as const,
        region: null,
        status: "healthy" as const,
        createdAt: d.created_at,
        business: businessFor(d.name, rules),
      }));
    },
    () => demoDatabases().filter((d) => d.provider === "cloudflare-d1"),
  );
}
