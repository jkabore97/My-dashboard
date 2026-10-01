import { cache } from "react";
import { env } from "../source";
import { listConnections } from "./store/connections";

// Credentials come from connections made in the UI (encrypted in the
// database) first, then fall back to environment variables.

async function first<S>(provider: Parameters<typeof listConnections>[0]) {
  try {
    return (await listConnections<S>(provider))[0] ?? null;
  } catch {
    return null;
  }
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
  try {
    for (const c of await listConnections<{ refreshToken: string }>("gmail")) {
      out.push({ label: c.label || c.business || c.account, refreshToken: c.secret.refreshToken, email: c.account });
    }
  } catch {
    /* database unavailable: env only */
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
