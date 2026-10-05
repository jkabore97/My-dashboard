import { env } from "../source";

export interface PasskeyRp {
  /** Relying-party ID: the host of APP_URL, e.g. kaj-command-center.vercel.app. */
  rpID: string;
  /** Exact origin assertions must come from, e.g. https://kaj-command-center.vercel.app. */
  origin: string;
  rpName: string;
}

const LOCAL = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Where passkeys are bound. Always from configuration: APP_URL, else (on
 * Vercel) the production domain Vercel reports. Request headers are only used
 * in local development, and only for a localhost host, where browsers allow
 * WebAuthn over plain http. Null = passkeys can't work here.
 */
export function passkeyRp(devHost?: string | null): PasskeyRp | null {
  const configured = env("APP_URL") ?? (env("VERCEL_PROJECT_PRODUCTION_URL") ? `https://${env("VERCEL_PROJECT_PRODUCTION_URL")}` : undefined);
  let url: URL | null = null;
  if (configured) {
    try {
      url = new URL(configured);
    } catch {
      return null;
    }
  } else if (process.env.NODE_ENV !== "production" && devHost) {
    try {
      const u = new URL(`http://${devHost}`);
      if (LOCAL.has(u.hostname)) url = u;
    } catch {
      /* not a host */
    }
  }
  if (!url) return null;
  // WebAuthn needs a secure context: https, or http on localhost.
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOCAL.has(url.hostname))) return null;
  return { rpID: url.hostname, origin: url.origin, rpName: "Kaj Command Center" };
}

/** PASSKEYS=false turns passkeys off everywhere (sign-in, 2FA and registration). */
export const passkeysSwitchedOn = () => env("PASSKEYS")?.toLowerCase() !== "false";
