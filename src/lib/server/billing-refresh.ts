import { createHash } from "node:crypto";
import { after } from "next/server";
import { today as todayFn } from "../dates";
import type { MsBilling, PlatformBilling } from "../billing/types";
import { fetchMsBilling } from "../connectors/msadmin";
import { fetchGcpCosts, type GcpCosts } from "../connectors/gcloud";
import { anthropicBilling, cloudflareBilling, githubBilling, supabaseBilling, vercelBilling } from "../connectors/platform-billing";
import { searchBillEmails } from "../connectors/billmail";
import { env, errorMessage } from "../source";
import { getConfig, type BusinessRule } from "./config";
import { cloudflareCreds, gcloudConnection, githubToken, googleClient, gmailAccounts, microsoftAccounts, msAdminConnection, supabaseToken, vercelCreds, type GoogleAccount } from "./credentials";
import { msClient } from "./microsoft";
import { gcpAccessToken } from "./gcloud";
import { claimInterval } from "./store/settings";
import { HOUR, readSlow, writeSlow } from "./slow-cache";

// Billing reads (Azure invoices, the BigQuery cost query, other platforms'
// billing APIs, the mailbox search) are slow, so pages never wait for them:
// collect() reads whatever is cached (readBilling) and, when something is
// stale, asks for a background refresh (scheduleBillingRefresh). The tick and
// the daily cron refresh billing as their own step after alerts, within the
// time they have left (refreshBilling with a deadline).

export const BILLING_KEYS = { microsoft: "msbilling", google: "gcpcosts", platforms: "platform-billing", mail: "bill-emails" } as const;
type Key = (typeof BILLING_KEYS)[keyof typeof BILLING_KEYS];

/** Which billing caches a connection change affects. Personal mailboxes affect none. */
export function billingCachesFor(provider: string, personal = false): Key[] {
  if (personal) return [];
  if (provider === "msadmin") return [BILLING_KEYS.microsoft];
  if (provider === "gcloud") return [BILLING_KEYS.google];
  if (["cloudflare", "github", "vercel", "supabase"].includes(provider)) return [BILLING_KEYS.platforms];
  if (provider === "microsoft" || provider === "gmail") return [BILLING_KEYS.mail];
  return [];
}

const hash = (v: string | null | undefined) => (v ? createHash("sha256").update(v).digest("hex").slice(0, 16) : null);
/** Whole-job cap: one billing read never runs past this, whatever its calls do. */
const JOB_MS = 30_000;

export interface MailFound {
  bills: import("../billing/types").DetectedBill[];
  rejected: string[];
}

interface Job<T> {
  key: Key;
  inputs: unknown;
  run: (signal: AbortSignal) => Promise<T>;
  ttl: (v: T) => number;
}

/** The billing reads that apply (credentials exist), with the inputs their caches are keyed on (hashed; secrets only as fingerprints). */
async function billingJobs(rules: BusinessRule[]) {
  const today = todayFn();
  const [ms, sa, cf, gh, vc, sb, msMail, gMail] = await Promise.all([
    msAdminConnection(),
    gcloudConnection(),
    cloudflareCreds(),
    githubToken(),
    vercelCreds(),
    supabaseToken(),
    microsoftAccounts(),
    googleClient() ? gmailAccounts() : Promise.resolve([] as GoogleAccount[]),
  ]);
  const admin = env("ANTHROPIC_ADMIN_KEY") ?? null;
  const microsoft: Job<MsBilling> | null =
    ms && msClient()
      ? { key: BILLING_KEYS.microsoft, inputs: [ms.account, rules], run: (signal) => fetchMsBilling({ account: ms.account, refreshToken: ms.refreshToken }, rules, today, signal), ttl: (b) => (b.error ? HOUR : 6 * HOUR) }
      : null;
  const google: Job<GcpCosts> | null = sa
    ? {
        key: BILLING_KEYS.google,
        // A rotated key (new id, or same id with a new key) or a new table reads afresh.
        inputs: [sa.clientEmail, sa.privateKeyId, hash(sa.privateKey), sa.exportTable, rules],
        run: async (signal) => fetchGcpCosts(await gcpAccessToken(sa), sa.exportTable, rules, today, signal),
        ttl: (r) => (r.export.status === "ok" ? 6 * HOUR : HOUR),
      }
    : null;
  const any = !!(cf || gh || vc || sb || admin);
  const platforms: Job<PlatformBilling[]> | null = any
    ? {
        key: BILLING_KEYS.platforms,
        inputs: [hash(cf?.token), cf?.accountId, hash(gh), hash(vc?.token), vc?.teamId, hash(sb), hash(admin), rules],
        run: (signal) =>
          Promise.all([
            ...(cf ? [cloudflareBilling(cf, rules, signal)] : []),
            ...(gh ? [githubBilling(gh, rules, today, signal)] : []),
            ...(vc ? [vercelBilling(vc, rules, today, signal)] : []),
            ...(sb ? [supabaseBilling(sb, signal)] : []),
            ...(admin ? [anthropicBilling(admin, today, signal)] : []),
          ]),
        ttl: (list) => (list.some((p) => p.status === "error") ? HOUR : 6 * HOUR),
      }
    : null;
  const mail: Job<MailFound> | null =
    msMail.length + gMail.length > 0
      ? {
          key: BILLING_KEYS.mail,
          // Mailbox and business (a relabel re-tags detections), never tokens.
          inputs: [...msMail.map((a) => [`ms:${a.account}`, a.business]), ...gMail.map((a) => [hash(a.id), a.business])],
          run: (signal) => searchBillEmails(msMail, gMail, signal),
          ttl: () => 6 * HOUR,
        }
      : null;
  return { microsoft, google, platforms, mail };
}

type Jobs = Awaited<ReturnType<typeof billingJobs>>;

export interface BillingRead {
  microsoft: MsBilling | null;
  google: GcpCosts | null;
  platforms: PlatformBilling[] | null;
  mail: MailFound | null;
  /** Which reads apply at all (their credentials exist). */
  configured: { microsoft: boolean; google: boolean; platforms: boolean; mail: boolean };
  /** Something is missing or past its age limit. */
  stale: boolean;
}

/** Whatever billing is cached for the current credentials. Never calls a platform. */
export async function readBilling(rules: BusinessRule[]): Promise<BillingRead> {
  const jobs = await billingJobs(rules);
  const read = async <T,>(j: Job<T> | null) => (j ? readSlow<T>(j.key, j.inputs) : null);
  const [m, g, p, e] = await Promise.all([read(jobs.microsoft), read(jobs.google), read(jobs.platforms), read(jobs.mail)]);
  return {
    microsoft: m?.value ?? null,
    google: g?.value ?? null,
    platforms: p?.value ?? null,
    mail: e?.value ?? null,
    configured: { microsoft: !!jobs.microsoft, google: !!jobs.google, platforms: !!jobs.platforms, mail: !!jobs.mail },
    stale: [m, g, p, e].some((x) => x && x.stale),
  };
}

/**
 * Re-reads the billing caches that are stale (or all, with `force`), each
 * capped at 30 s and none started past `deadline`. Returns the keys refreshed.
 * A read that fails leaves the previous cache in place.
 */
export async function refreshBilling(opts: { deadline?: number; force?: boolean; only?: Key[] } = {}): Promise<string[]> {
  const { businessRules } = await getConfig();
  const jobs: Jobs = await billingJobs(businessRules);
  const list = (Object.values(jobs) as (Job<unknown> | null)[]).filter((j): j is Job<unknown> => !!j && (!opts.only || opts.only.includes(j.key)));
  const due: Job<unknown>[] = [];
  for (const j of list) if (opts.force || (await readSlow(j.key, j.inputs)).stale) due.push(j);
  const left = (opts.deadline ?? Date.now() + JOB_MS) - Date.now();
  if (!due.length || left < 2_000) return [];
  const cap = Math.min(JOB_MS, left);
  const done = await Promise.allSettled(
    due.map(async (j) => {
      const signal = AbortSignal.timeout(cap);
      await writeSlow(j.key, j.inputs, () => j.run(signal), j.ttl);
      return j.key;
    }),
  );
  done.forEach((r, i) => r.status === "rejected" && console.error(`[billing] ${due[i].key}: ${errorMessage(r.reason)}`));
  return done.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
}

/** Lease shared by the background refresh and the scheduled runs, so billing is read once at a time. */
export const claimBillingRefresh = () => claimInterval("job:billing", 120).catch(() => false);

/** After the response: refresh stale billing (one instance at a time). Pages never wait for it. */
export function scheduleBillingRefresh() {
  const run = async () => {
    if (!(await claimBillingRefresh())) return;
    await refreshBilling({ deadline: Date.now() + 40_000 }).catch((err) => console.error(`[billing] ${errorMessage(err)}`));
  };
  try {
    after(run);
  } catch {
    void run();
  }
}
