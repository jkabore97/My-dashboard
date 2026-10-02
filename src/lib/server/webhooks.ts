import { decrypt, hmacHex, safeEqual } from "./crypto";
import { getSetting } from "./store/settings";
import { env } from "../source";

export type WebhookProvider = "github" | "vercel" | "stripe" | "supabase" | "hikvision";

export const WEBHOOK_ENV: Record<WebhookProvider, string> = {
  github: "GITHUB_WEBHOOK_SECRET",
  vercel: "VERCEL_WEBHOOK_SECRET",
  stripe: "STRIPE_WEBHOOK_SECRET",
  supabase: "SUPABASE_WEBHOOK_SECRET",
  hikvision: "HIKVISION_WEBHOOK_SECRET",
};

/** Env var wins; otherwise the (encrypted) secret saved on the Platforms page. */
export async function webhookSecret(provider: WebhookProvider): Promise<string | null> {
  const fromEnv = env(WEBHOOK_ENV[provider]);
  if (fromEnv) return fromEnv;
  const stored = await getSetting<string | null>(`webhook_secret:${provider}`, null);
  if (!stored) return null;
  try {
    return decrypt(stored);
  } catch {
    return null;
  }
}

export function verifyGithub(secret: string, raw: string, header: string | null) {
  if (!header?.startsWith("sha256=")) return false;
  return safeEqual(header, `sha256=${hmacHex("sha256", secret, raw)}`);
}

export function verifyVercel(secret: string, raw: string, header: string | null) {
  if (!header) return false;
  return safeEqual(header, hmacHex("sha1", secret, raw));
}

/** Stripe-Signature: t=<unix>,v1=<hex>[,v1=...]; rejects events older than 5 minutes. */
export function verifyStripe(secret: string, raw: string, header: string | null, nowSec = Math.floor(Date.now() / 1000)) {
  if (!header) return false;
  const parts = header.split(",").map((p) => p.split("=") as [string, string]);
  const t = Number(parts.find(([k]) => k === "t")?.[1]);
  if (!Number.isFinite(t) || Math.abs(nowSec - t) > 300) return false;
  const expected = hmacHex("sha256", secret, `${t}.${raw}`);
  return parts.some(([k, v]) => k === "v1" && !!v && safeEqual(v, expected));
}

/** Supabase database webhooks: a shared secret sent as a custom header. */
export function verifySharedSecret(secret: string, header: string | null) {
  if (!header) return false;
  return safeEqual(header.replace(/^Bearer\s+/i, ""), secret);
}
