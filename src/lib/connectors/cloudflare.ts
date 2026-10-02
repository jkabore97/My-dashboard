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

interface D1Database {
  uuid: string;
  name: string;
  created_at: string;
  file_size?: number;
  num_tables?: number;
  version?: string;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);

export function mapD1(d: D1Database, rules: BusinessRule[]): Database {
  return {
    id: d.uuid,
    name: d.name,
    provider: "cloudflare-d1",
    region: null,
    status: "healthy",
    createdAt: d.created_at,
    business: businessFor(d.name, rules),
    // The list endpoint reports size and table count; nothing is estimated.
    sizeBytes: num(d.file_size),
    tables: num(d.num_tables),
    engine: "SQLite (D1)",
  };
}

export async function getCloudflareD1(rules: BusinessRule[]) {
  const creds = await cloudflareCreds();
  return fromSource<Database[]>(
    "Cloudflare",
    !!creds,
    async () => {
      const dbs = await cfGet<D1Database[]>(creds!, "/d1/database");
      return dbs.map((d) => mapD1(d, rules));
    },
    () => demoDatabases().filter((d) => d.provider === "cloudflare-d1"),
  );
}
