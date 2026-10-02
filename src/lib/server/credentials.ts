import { cache } from "react";
import { env } from "../source";
import { readConnections, type Connection, type Provider } from "./store/connections";
import { canConnectPersonal } from "../access";
import { accessFor, rowAllowed } from "./auth";
import { getDb } from "./db";

/**
 * People whose personal mailboxes may still be read: they can still sign in
 * (not disabled; environment owners still configured) and their access still
 * includes Inbox or Agenda. Anyone else's connection is kept but not fetched.
 */
async function activePersonalOwners(emails: string[]): Promise<Set<string>> {
  if (!emails.length) return new Set();
  const db = await getDb();
  const rows = await db.query<{ email: string; role: string | null; businesses: string[] | null; sections: string[] | null; disabled_at: Date | string | null }>(
    "select email, role, businesses, sections, disabled_at from users where email = any($1::text[])",
    [emails],
  );
  return new Set(rows.filter((r) => rowAllowed(r, r.email) && canConnectPersonal(accessFor(r))).map((r) => r.email));
}

// Credentials come from connections made in the UI (encrypted in the
// database) first, then fall back to environment variables.

const loadConnections = cache(async () => {
  try {
    const { list, undecryptable } = await readConnections<Record<string, string>>();
    return { ok: undecryptable.length === 0, list, undecryptable };
  } catch {
    return { ok: false, list: [], undecryptable: [] as { provider: Provider; account: string; ownerEmail: string | null }[] };
  }
});

/** Shared connections only: personal mailboxes never feed the shared sources. */
const sharedConnections = async () => (await loadConnections()).list.filter((c) => !c.ownerEmail);

/**
 * `readable` is false when stored connections couldn't all be read (database
 * down, or rows that no longer decrypt), so a provider that looks unconnected
 * may not be. `undecryptable` lists the latter.
 */
export const connectionHealth = async () => {
  const { ok, undecryptable } = await loadConnections();
  return { readable: ok, undecryptable };
};

// One connection per provider except Gmail (connecting another replaces it);
// the newest wins should older duplicates exist.
async function first<S>(provider: Provider) {
  const mine = (await sharedConnections()).filter((c) => c.provider === provider);
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

export interface GoogleAccount {
  /** Stable across relabeling: the address, or env:<label> for GMAIL_ACCOUNTS entries. */
  id: string;
  label: string;
  business: string | null;
  refreshToken: string;
  email?: string;
  /** Granted OAuth scopes; null when unknown (older connections, env accounts). */
  scopes: string[] | null;
  /** Set for a personal account: whose it is. */
  owner?: string;
}

/** Every shared Google account (mail, calendar, Analytics, Search Console). */
export const googleAccounts = cache(async (): Promise<GoogleAccount[]> => {
  const out: GoogleAccount[] = [];
  for (const c of await sharedConnections()) {
    if (c.provider !== "gmail") continue;
    const scopes = Array.isArray(c.meta?.scopes) ? (c.meta.scopes as string[]) : null;
    out.push({ id: c.account, label: c.label || c.business || c.account, business: c.business, refreshToken: c.secret.refreshToken, email: c.account, scopes });
  }
  for (const pair of (env("GMAIL_ACCOUNTS") ?? "").split(",")) {
    const i = pair.lastIndexOf(":");
    const label = pair.slice(0, i).trim();
    const refreshToken = pair.slice(i + 1).trim();
    if (label && refreshToken && i > 0) out.push({ id: `env:${label}`, label, business: label, refreshToken, scopes: null });
  }
  return out;
});

export type GmailAccount = GoogleAccount;

/** Google accounts that granted (or may have granted) Gmail access. */
export const gmailAccounts = cache(async () => (await googleAccounts()).filter((a) => !a.scopes || a.scopes.some((s) => s.endsWith("/gmail.readonly"))));

export interface MicrosoftAccount {
  /** The account's address; mailbox ids are "ms:<address>". */
  account: string;
  label: string;
  business: string | null;
  refreshToken: string;
  /** Set for a personal account: whose it is. */
  owner?: string;
}

/** Shared Microsoft 365 accounts (Outlook mail + calendar). */
export const microsoftAccounts = cache(async (): Promise<MicrosoftAccount[]> =>
  (await sharedConnections())
    .filter((c) => c.provider === "microsoft")
    .map((c) => ({ account: c.account, label: c.label || c.business || c.account, business: c.business, refreshToken: c.secret.refreshToken })),
);

/** People's own Microsoft and Google accounts (mail + calendar), each with its owner. Never business-tagged. */
export const personalAccounts = cache(async (): Promise<{ microsoft: MicrosoftAccount[]; google: GoogleAccount[] }> => {
  const all = (await loadConnections()).list.filter((c) => !!c.ownerEmail);
  const active = await activePersonalOwners([...new Set(all.map((c) => c.ownerEmail!))]).catch(() => new Set<string>());
  const mine = all.filter((c) => active.has(c.ownerEmail!));
  return {
    microsoft: mine.filter((c) => c.provider === "microsoft").map((c) => ({ account: c.account, label: c.account, business: null, refreshToken: c.secret.refreshToken, owner: c.ownerEmail! })),
    google: mine
      .filter((c) => c.provider === "gmail")
      .map((c) => ({ id: c.account, label: c.account, business: null, refreshToken: c.secret.refreshToken, email: c.account, scopes: Array.isArray(c.meta?.scopes) ? (c.meta.scopes as string[]) : null, owner: c.ownerEmail! })),
  };
});

export interface StripeAccount {
  /** Stable id: the Stripe account (or key fingerprint), or env:<business>. */
  id: string;
  business: string;
  key: string;
}

// STRIPE_SECRET_KEYS="Kaj Consulting:rk_live_…,Kaj Store:rk_live_…"
export const stripeAccounts = cache(async (): Promise<StripeAccount[]> => {
  const out: StripeAccount[] = [];
  for (const c of await sharedConnections()) {
    if (c.provider === "stripe") out.push({ id: c.account, business: c.business || c.label || c.account, key: c.secret.token });
  }
  for (const pair of (env("STRIPE_SECRET_KEYS") ?? "").split(",")) {
    const i = pair.lastIndexOf(":");
    const business = pair.slice(0, i).trim();
    const key = pair.slice(i + 1).trim();
    if (business && key && i > 0) out.push({ id: `env:${business}`, business, key });
  }
  return out;
});

export const googleClient = () => {
  const id = env("GOOGLE_CLIENT_ID");
  const secret = env("GOOGLE_CLIENT_SECRET");
  return id && secret ? { id, secret } : null;
};
