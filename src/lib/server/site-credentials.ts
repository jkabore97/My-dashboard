import { lookup as dnsLookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { cache } from "react";
import { readConnections } from "./store/connections";

// Credentials for on-site equipment (cameras now; more later), stored as
// encrypted connections like every other platform.

export interface HikvisionSite {
  /** Connection account: the NVR's base URL host, stable across relabeling. */
  id: string;
  label: string;
  business: string | null;
  baseUrl: string;
  username: string;
  password: string;
  cfClientId?: string;
  cfClientSecret?: string;
}

export const hikvisionSites = cache(async (): Promise<HikvisionSite[]> => {
  try {
    const { list } = await readConnections<Omit<HikvisionSite, "id" | "label" | "business">>("hikvision");
    return list.map((c) => ({ id: c.account, label: c.label || c.account, business: c.business, ...c.secret }));
  } catch {
    return [];
  }
});

export async function hikvisionSite(id: string): Promise<HikvisionSite | null> {
  return (await hikvisionSites()).find((s) => s.id === id) ?? null;
}

/**
 * The connection account (and site id in URLs and task keys) for an NVR
 * address: host plus path, so two NVRs behind one tunnel hostname on
 * different paths stay separate. "/" becomes "~" to keep it one URL segment
 * (the alarm-server webhook URL carries it).
 */
export const siteAccount = (url: string) => {
  const u = new URL(url);
  return `${u.host}${u.pathname.replace(/\/+$/, "").replace(/\//g, "~")}`;
};

const PRIVATE = new BlockList();
for (const [net, bits] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 3]] as const) PRIVATE.addSubnet(net, bits, "ipv4");
for (const [net, bits] of [["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8]] as const) PRIVATE.addSubnet(net, bits, "ipv6");

/** Loopback, private, link-local, shared (CGNAT), unspecified or multicast. IPv4-mapped IPv6 is judged by its IPv4 part. */
export function isPrivateAddress(ip: string): boolean {
  const mapped = ip.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (mapped) return PRIVATE.check(mapped, "ipv4");
  const v = isIP(ip);
  return v === 4 ? PRIVATE.check(ip, "ipv4") : v === 6 ? PRIVATE.check(ip, "ipv6") : true;
}

export type Lookup = (host: string) => Promise<{ address: string }[]>;
const defaultLookup: Lookup = (host) => dnsLookup(host, { all: true, verbatim: true });

/**
 * Refuses a hostname that resolves to a private address, so a public-looking
 * name (127.0.0.1.nip.io) can't point the server at its own network. Checked
 * when connecting and again before each request, since DNS can change.
 */
export async function assertPublicHost(host: string, lookup: Lookup = defaultLookup) {
  let addrs: { address: string }[];
  try {
    addrs = await lookup(host);
  } catch {
    throw new Error(`${host} doesn't resolve`);
  }
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) throw new Error(`${host} resolves to a local or private address; use the tunnel's public hostname`);
}

/**
 * Only public https endpoints (a tunnel hostname) are accepted, so the
 * dashboard can't be pointed at its own host's internal network. IP literals
 * of any kind are refused; names are also resolved (assertPublicHost).
 */
export function validateSiteUrl(raw: string): { ok: true; url: string } | { ok: false; error: string } {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return { ok: false, error: "Enter the full tunnel address, e.g. https://nvr.yourdomain.com" };
  }
  if (u.protocol !== "https:") return { ok: false, error: "Use the https:// address of your tunnel (Cloudflare Tunnel or Tailscale Funnel)." };
  const h = u.hostname.toLowerCase();
  const privateHost = h.startsWith("[") || isIP(h) !== 0 || h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || /^\[?(::1|fc|fd|fe80)/i.test(h) || /^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h) || /^\d+\.\d+\.\d+\.\d+$/.test(h);
  if (privateHost) return { ok: false, error: "Use the tunnel's public hostname, not a local or IP address." };
  if (u.username || u.password) return { ok: false, error: "Put the login in the username and password fields, not the address." };
  return { ok: true, url: `${u.origin}${u.pathname.replace(/\/+$/, "")}` };
}
