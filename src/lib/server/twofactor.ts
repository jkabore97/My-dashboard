import { randomBytes } from "node:crypto";
import { decrypt, encrypt, randomToken, safeEqual, sha256Hex } from "./crypto";
import { getSetting, setSetting } from "./store/settings";
import { generateSecret, verifyTotp } from "./totp";
import { consumeRecoveryCode, enableTotp, getUser, markTotpStep, setPendingTotp } from "./store/users";

const normalizeRecovery = (code: string) => code.toLowerCase().replace(/[^a-z0-9]/g, "");
const hashRecovery = (code: string) => sha256Hex(`kcc-recovery:${normalizeRecovery(code)}`);

export function newRecoveryCodes(count = 10) {
  const codes = Array.from({ length: count }, () => {
    const raw = randomBytes(6).toString("hex"); // 12 hex chars
    return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`;
  });
  return { codes, hashes: codes.map(hashRecovery) };
}

/** Returns the pending enrollment secret, creating one if needed. */
export async function pendingSecret(email: string): Promise<string> {
  const user = await getUser(email);
  if (user?.totp_pending_secret) {
    try {
      return decrypt(user.totp_pending_secret);
    } catch {
      /* key rotated: make a new one */
    }
  }
  const secret = generateSecret();
  await setPendingTotp(email, encrypt(secret));
  return secret;
}

/** Confirms enrollment with a first code. Returns recovery codes on success. */
export async function confirmEnrollment(email: string, code: string): Promise<string[] | null> {
  const user = await getUser(email);
  if (!user?.totp_pending_secret) return null;
  const secret = decrypt(user.totp_pending_secret);
  const step = verifyTotp(secret, code, null);
  if (step === null) return null;
  const { codes, hashes } = newRecoveryCodes();
  await enableTotp(email, encrypt(secret), step, hashes);
  return codes;
}

const isTotpShaped = (s: string) => /^\d[\d\s]{5,7}$/.test(s);

/** Verifies a TOTP code (no reuse) or consumes a recovery code. */
export async function verifySecondFactor(email: string, input: string): Promise<"totp" | "recovery" | null> {
  if (await verifyTotpOnly(email, input)) return "totp";
  const trimmed = input.trim();
  if (isTotpShaped(trimmed)) return null;
  const user = await getUser(email);
  if (user?.totp_secret && normalizeRecovery(trimmed).length === 12 && (await consumeRecoveryCode(email, hashRecovery(trimmed)))) return "recovery";
  return null;
}

/** Verifies an authenticator code (no reuse). Never touches recovery codes. */
export async function verifyTotpOnly(email: string, input: string): Promise<boolean> {
  const trimmed = input.trim();
  if (!isTotpShaped(trimmed)) return false;
  const user = await getUser(email);
  if (!user?.totp_secret) return false;
  const last = user.totp_last_step == null ? null : Number(user.totp_last_step);
  const step = verifyTotp(decrypt(user.totp_secret), trimmed, last);
  return step !== null && (await markTotpStep(email, step));
}

/** One-time token that lets the browser that just enrolled upgrade its session. */
export async function createFinishToken(email: string) {
  const token = randomToken(24);
  await setSetting(`enroll_finish:${email}`, { hash: sha256Hex(token), exp: Date.now() + 10 * 60_000 });
  return token;
}

export async function consumeFinishToken(email: string, token: string) {
  const key = `enroll_finish:${email}`;
  const stored = await getSetting<{ hash: string; exp: number } | null>(key, null);
  if (!stored || !token) return false;
  await setSetting(key, null);
  return stored.exp > Date.now() && safeEqual(stored.hash, sha256Hex(token));
}

export { hashRecovery };
