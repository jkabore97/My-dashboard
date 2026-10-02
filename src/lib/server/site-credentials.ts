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
 * Only public https endpoints (a tunnel hostname) are accepted, so the
 * dashboard can't be pointed at its own host's internal network.
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
  const privateHost = h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || /^\[?(::1|fc|fd|fe80)/i.test(h) || /^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h) || /^\d+\.\d+\.\d+\.\d+$/.test(h);
  if (privateHost) return { ok: false, error: "Use the tunnel's public hostname, not a local or IP address." };
  if (u.username || u.password) return { ok: false, error: "Put the login in the username and password fields, not the address." };
  return { ok: true, url: `${u.origin}${u.pathname.replace(/\/+$/, "")}` };
}
