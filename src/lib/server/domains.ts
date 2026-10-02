import { connect } from "node:tls";
import { errorMessage } from "../source";
import { claimInterval } from "./store/settings";
import { latestSnapshot, recordSnapshot } from "./store/snapshots";

// Registration expiry (RDAP), certificate expiry (TLS handshake) and email
// authentication (SPF / DMARC / DKIM via DNS-over-HTTPS, which works on any
// host including serverless). Results are cached as snapshots and refreshed
// twice a day by cron; the Domains page can force a refresh.

export const CHECK_INTERVAL_SECONDS = 12 * 3600;
export const DEFAULT_DKIM_SELECTORS = ["google", "selector1", "selector2", "default", "k1", "s1", "mail", "dkim"];

type Check<T> = ({ ok: true } & T) | { ok: false; error: string };

export interface DomainCheck {
  domain: string;
  checkedAt: string;
  registration: Check<{ expiresOn: string | null; registrar: string | null }>;
  certificate: Check<{ expiresOn: string; issuer: string | null }>;
  email: Check<{ mx: string[]; spf: string | null; dmarc: string | null; dmarcPolicy: string | null; dkim: string[] }>;
}

// Common multi-label public suffixes. Registration lives at the label just
// below these (shop.example.co.uk → example.co.uk). Not the full public
// suffix list, but covers the usual business TLDs.
const MULTI_SUFFIXES = new Set(["co.uk", "org.uk", "ac.uk", "gov.uk", "com.au", "net.au", "org.au", "co.nz", "co.za", "com.br", "com.mx", "co.jp", "co.in", "com.sg", "com.ng", "co.ke", "com.gh", "com.tr", "co.il", "com.cn", "com.hk"]);

export function registrableDomain(host: string): string {
  const labels = host.toLowerCase().replace(/\.$/, "").split(".");
  if (labels.length <= 2) return labels.join(".");
  const lastTwo = labels.slice(-2).join(".");
  return labels.slice(MULTI_SUFFIXES.has(lastTwo) ? -3 : -2).join(".");
}

// ─── Parsers (pure, tested with recorded responses) ─────────────────────────

interface RdapResponse {
  events?: { eventAction: string; eventDate: string }[];
  entities?: { roles?: string[]; vcardArray?: [string, [string, unknown, string, string][]] }[];
}

export function parseRdap(r: RdapResponse): { expiresOn: string | null; registrar: string | null } {
  const exp = r.events?.find((e) => e.eventAction === "expiration")?.eventDate;
  const registrar = r.entities?.find((e) => e.roles?.includes("registrar"));
  const fn = registrar?.vcardArray?.[1]?.find((f) => f[0] === "fn")?.[3];
  return { expiresOn: exp ? new Date(exp).toISOString().slice(0, 10) : null, registrar: typeof fn === "string" ? fn : null };
}

/** DoH JSON answers quote TXT strings and may split long ones: "v=spf1 " "include:…" */
export function txtValues(answers: { type: number; data: string }[] = []): string[] {
  return answers.filter((a) => a.type === 16).map((a) => (a.data.match(/"((?:[^"\\]|\\.)*)"/g) ?? [a.data]).map((p) => p.replace(/^"|"$/g, "").replace(/\\"/g, '"')).join(""));
}

export function parseEmailAuth(input: { mx: string[]; rootTxt: string[]; dmarcTxt: string[]; dkimFound: string[] }) {
  const spf = input.rootTxt.find((t) => /^v=spf1(\s|$)/i.test(t)) ?? null;
  const dmarc = input.dmarcTxt.find((t) => /^v=DMARC1/i.test(t)) ?? null;
  const policy = dmarc?.match(/(?:^|;)\s*p\s*=\s*(\w+)/i)?.[1]?.toLowerCase() ?? null;
  return { mx: input.mx, spf, dmarc, dmarcPolicy: policy, dkim: input.dkimFound };
}

// ─── Network lookups (injectable for tests) ──────────────────────────────────

export interface Lookups {
  fetchJson: (url: string, headers?: Record<string, string>) => Promise<unknown>;
  certificate: (host: string) => Promise<{ expiresOn: string; issuer: string | null }>;
}

const defaultLookups: Lookups = {
  async fetchJson(url, headers = {}) {
    const res = await fetch(url, { headers: { Accept: "application/json", ...headers }, cache: "no-store", signal: AbortSignal.timeout(10_000), redirect: "follow" });
    if (!res.ok) throw new Error(`${res.status} from ${new URL(url).host}`);
    return res.json();
  },
  certificate(host) {
    return new Promise((resolve, reject) => {
      const socket = connect({ host, port: 443, servername: host, timeout: 8000 }, () => {
        const cert = socket.getPeerCertificate();
        socket.end();
        if (!cert?.valid_to) return reject(new Error("no certificate"));
        const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
        resolve({ expiresOn: new Date(cert.valid_to).toISOString().slice(0, 10), issuer: first(cert.issuer?.O) ?? first(cert.issuer?.CN) ?? null });
      });
      socket.on("timeout", () => socket.destroy(new Error("TLS handshake timed out")));
      socket.on("error", reject);
    });
  },
};

async function doh(l: Lookups, name: string, type: "TXT" | "MX") {
  const r = (await l.fetchJson(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`, { Accept: "application/dns-json" })) as { Status: number; Answer?: { type: number; data: string }[] };
  if (r.Status !== 0 && r.Status !== 3) throw new Error(`DNS lookup for ${name} failed (status ${r.Status})`); // 3 = NXDOMAIN: simply no record
  return r.Answer ?? [];
}

const settle = async <T,>(p: Promise<T>): Promise<Check<T>> => p.then((v) => ({ ok: true as const, ...v })).catch((e) => ({ ok: false as const, error: errorMessage(e) }));

export async function checkDomain(domain: string, dkimSelectors: string[], l: Lookups = defaultLookups): Promise<DomainCheck> {
  const apex = registrableDomain(domain);
  const [registration, certificate, email] = await Promise.all([
    settle(l.fetchJson(`https://rdap.org/domain/${apex}`).then((r) => parseRdap(r as RdapResponse))),
    settle(l.certificate(domain)),
    settle(
      (async () => {
        const [mx, root, dmarc, ...dkim] = await Promise.all([
          doh(l, apex, "MX"),
          doh(l, apex, "TXT"),
          doh(l, `_dmarc.${apex}`, "TXT"),
          ...dkimSelectors.map((s) => doh(l, `${s}._domainkey.${apex}`, "TXT").catch(() => [])),
        ]);
        return parseEmailAuth({
          mx: mx.filter((a) => a.type === 15).map((a) => a.data.split(" ").pop()!.replace(/\.$/, "")),
          rootTxt: txtValues(root),
          dmarcTxt: txtValues(dmarc),
          dkimFound: dkimSelectors.filter((_, i) => txtValues(dkim[i]).some((t) => /p=/.test(t))),
        });
      })(),
    ),
  ]);
  return { domain, checkedAt: new Date().toISOString(), registration, certificate, email };
}

/**
 * Checks every domain whose last check is older than the interval (or all of
 * them when forced). Returns how many were checked.
 */
export async function refreshDomainChecks(domains: string[], dkimSelectors: string[], { force = false, lookups }: { force?: boolean; lookups?: Lookups } = {}) {
  let checked = 0;
  for (const d of domains) {
    if (!(await claimInterval(`job:domain:${d}`, force ? 60 : CHECK_INTERVAL_SECONDS))) continue;
    await recordSnapshot("domain", d, await checkDomain(d, dkimSelectors, lookups));
    checked++;
  }
  return checked;
}

export const latestDomainCheck = (domain: string) => latestSnapshot<DomainCheck>("domain", domain);
