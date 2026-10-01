import { audit } from "./store/audit";
import { refundAttempt, takeAttempt } from "./store/ratelimit";

export interface Limit {
  key: string;
  limit: number;
  windowSeconds: number;
}

/**
 * Password sign-in. With a trustworthy IP the limit is per IP only (2FA guards
 * the rest), so nobody can lock the owner out from elsewhere. Without one,
 * every caller shares a loose bucket for the identity: a lockout then takes
 * sustained volume, and is audited.
 */
export const loginLimit = (ip: string | null, identity: string): Limit =>
  ip ? { key: `login:ip:${ip}`, limit: 10, windowSeconds: 15 * 60 } : { key: `login:unknown-ip:${identity}`, limit: 100, windowSeconds: 60 * 60 };

export const twoFactorLimit = (email: string): Limit => ({ key: `2fa:${email}`, limit: 6, windowSeconds: 10 * 60 });

/**
 * Takes an attempt; false when the limit is exhausted. Call succeeded() after
 * a correct attempt so only failures count. Audits the moment a limit trips.
 */
export async function attempt(l: Limit, actor: string, ip: string | null): Promise<boolean> {
  const n = await takeAttempt(l.key, l.windowSeconds);
  if (n === l.limit + 1) await audit(actor, "login.rate_limited", l.key, { limit: l.limit, windowSeconds: l.windowSeconds }, ip);
  return n <= l.limit;
}

export const succeeded = (l: Limit) => refundAttempt(l.key);
