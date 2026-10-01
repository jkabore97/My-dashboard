import { cache } from "react";
import { env } from "../source";
import { listConnections, type Connection, type Provider } from "./store/connections";

// Credentials come from connections made in the UI (encrypted in the
// database) first, then fall back to environment variables.

const loadConnections = cache(async () => {
  try {
    return { ok: true, list: await listConnections<Record<string, string>>() };
  } catch {
    return { ok: false, list: [] };
  }
});

/** False when stored connections couldn't be read (database down), so env fallbacks may be wrong. */
export const connectionsReadable = async () => (await loadConnections()).ok;

// One connection per provider except Gmail (connecting another replaces it);
// the newest wins should older duplicates exist.
async function first<S>(provider: Provider) {
  const mine = (await loadConnections()).list.filter((c) => c.provider === provider);
  return (mine.at(-1) as Connection<S> | undefined) ?? null;
}

export const githubToken = cache(async () => (await first<{ token: string }>("github"))?.secret.token ?? env("GITHUB_TOKEN") ?? null);

export const vercelCreds = cache(async () => {
  const c = await first<{ token: string; teamId?: string }>("vercel");
  if (c) return { token: c.secret.token, teamId: c.secret.teamId ?? null };
  const token = env("VERCEL_TOKEN");
  return token ? { token, teamId: env("VERCEL_TEAM_ID") ?? null } : null;
});

export const supabaseToken = cache(async () => (await first<{ token: string }>("supabase"))?.secret.token ?? env("SUPABASE_ACCESS_TOKEN") ?? null);

export const cloudflareCreds = cache(async () => {
  const c = await first<{ token: string; accountId: string }>("cloudflare");
  if (c) return c.secret;
  const token = env("CLOUDFLARE_API_TOKEN");
  const accountId = env("CLOUDFLARE_ACCOUNT_ID");
  return token && accountId ? { token, accountId } : null;
});

export interface GmailAccount {
  label: string;
  refreshToken: string;
  email?: string;
}

export const gmailAccounts = cache(async (): Promise<GmailAccount[]> => {
  const out: GmailAccount[] = [];
  for (const c of (await loadConnections()).list) {
    if (c.provider === "gmail") out.push({ label: c.label || c.business || c.account, refreshToken: c.secret.refreshToken, email: c.account });
  }
  for (const pair of (env("GMAIL_ACCOUNTS") ?? "").split(",")) {
    const i = pair.lastIndexOf(":");
    const label = pair.slice(0, i).trim();
    const refreshToken = pair.slice(i + 1).trim();
    if (label && refreshToken && i > 0) out.push({ label, refreshToken });
  }
  return out;
});

export const googleClient = () => {
  const id = env("GOOGLE_CLIENT_ID");
  const secret = env("GOOGLE_CLIENT_SECRET");
  return id && secret ? { id, secret } : null;
};
