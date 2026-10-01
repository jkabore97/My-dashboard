import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { isProduction } from "./db";

// Credentials (OAuth tokens, API keys, TOTP secrets) are encrypted with
// AES-256-GCM before they touch the database. ENCRYPTION_KEY is 32 random
// bytes, base64-encoded: `openssl rand -base64 32`.
function key(): Buffer {
  const raw = process.env.ENCRYPTION_KEY?.trim();
  if (raw) {
    const buf = Buffer.from(raw, "base64");
    if (buf.length !== 32) throw new Error("ENCRYPTION_KEY must be 32 bytes, base64-encoded (openssl rand -base64 32)");
    return buf;
  }
  if (isProduction()) throw new Error("ENCRYPTION_KEY is not set");
  return createHash("sha256").update("kcc-insecure-development-key").digest();
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), body.toString("base64")].join(":");
}

export function decrypt(payload: string): string {
  const [version, iv, tag, body] = payload.split(":");
  if (version !== "v1" || !iv || !tag || !body) throw new Error("Unrecognized ciphertext format");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64")), decipher.final()]).toString("utf8");
}

export const encryptJson = (value: unknown) => encrypt(JSON.stringify(value));
export const decryptJson = <T,>(payload: string) => JSON.parse(decrypt(payload)) as T;

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  // Compare digests so length differences don't leak through timing either.
  const hx = createHash("sha256").update(x).digest();
  const hy = createHash("sha256").update(y).digest();
  return timingSafeEqual(hx, hy) && x.length === y.length;
}

export function hmacHex(algorithm: "sha1" | "sha256", secret: string, data: string | Buffer) {
  return createHmac(algorithm, secret).update(data).digest("hex");
}

export function sha256Hex(data: string) {
  return createHash("sha256").update(data).digest("hex");
}

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}
