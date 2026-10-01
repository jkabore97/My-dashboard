import { afterEach, describe, expect, it, vi } from "vitest";
import { decrypt, encrypt, safeEqual } from "@/lib/server/crypto";
import { base32Decode, base32Encode, hotp, totp, verifyTotp, currentStep } from "@/lib/server/totp";
import { signSession, verifySession } from "@/lib/session";
import { clientIp, pickClientIp, sharedLoginLimitWarning } from "@/lib/server/auth";

vi.mock("next/headers", async (orig) => ({ ...(await orig<object>()), headers: async () => new Headers({ "x-real-ip": "6.6.6.6" }) }));

describe("encryption", () => {
  it("round-trips and uses a fresh IV each time", () => {
    const a = encrypt("secret-token");
    const b = encrypt("secret-token");
    expect(a).not.toEqual(b);
    expect(decrypt(a)).toBe("secret-token");
  });
  it("rejects tampered ciphertext", () => {
    const parts = encrypt("secret-token").split(":");
    const body = Buffer.from(parts[3], "base64");
    body[0] ^= 1;
    parts[3] = body.toString("base64");
    expect(() => decrypt(parts.join(":"))).toThrow();
  });
  it("compares safely", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});

describe("TOTP (RFC 6238 / 4226)", () => {
  const rfcSecret = Buffer.from("12345678901234567890");
  it("matches the RFC 4226 HOTP vectors", () => {
    expect(["755224", "287082", "359152", "969429", "338314"]).toEqual([0, 1, 2, 3, 4].map((c) => hotp(rfcSecret, c)));
  });
  it("matches the RFC 6238 SHA-1 vector at T=59 (8 digits: 94287082)", () => {
    expect(hotp(rfcSecret, Math.floor(59 / 30), 8)).toBe("94287082");
  });
  it("base32 round-trips", () => {
    expect(base32Decode(base32Encode(rfcSecret)).equals(rfcSecret)).toBe(true);
  });
  it("accepts ±1 step, rejects reuse and garbage", () => {
    const secret = base32Encode(rfcSecret);
    const now = Date.now();
    const code = totp(secret, now);
    const step = verifyTotp(secret, code, null, now);
    expect(step).toBe(currentStep(now));
    expect(verifyTotp(secret, code, step, now)).toBeNull();
    expect(verifyTotp(secret, totp(secret, now - 30_000), null, now)).toBe(currentStep(now) - 1);
    expect(verifyTotp(secret, totp(secret, now - 90_000), null, now)).toBeNull();
    expect(verifyTotp(secret, "abcdef", null, now)).toBeNull();
  });
});

describe("sessions", () => {
  const secret = "x".repeat(40);
  it("signs and verifies", async () => {
    const token = await signSession({ sub: "a@b.c", stage: "full", sv: 2 }, 60, secret);
    expect(await verifySession(token, secret)).toMatchObject({ sub: "a@b.c", stage: "full", sv: 2 });
  });
  it("rejects a wrong key, tampering and expiry", async () => {
    const token = await signSession({ sub: "a@b.c", stage: "pending", sv: 1 }, 60, secret);
    expect(await verifySession(token, "y".repeat(40))).toBeNull();
    const [body, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ sub: "a@b.c", stage: "full", sv: 1, iat: 0, exp: 9e9 })).toString("base64url");
    expect(await verifySession(`${forged}.${sig}`, secret)).toBeNull();
    expect(await verifySession(`${body}.`, secret)).toBeNull();
    const expired = await signSession({ sub: "a@b.c", stage: "full", sv: 1 }, -1, secret);
    expect(await verifySession(expired, secret)).toBeNull();
  });
});

describe("client IP", () => {
  const h = (o: Record<string, string>) => new Headers(o);
  const spoofable = { "x-forwarded-for": "6.6.6.6, 10.0.0.1", "x-real-ip": "10.0.0.2", "x-vercel-forwarded-for": "1.1.1.1" };
  it("is unknown without a platform or proxy that sets the headers", () => {
    expect(pickClientIp(h(spoofable), { onVercel: false, trustedProxy: false })).toBeNull();
  });
  it("uses Vercel's header on Vercel", () => {
    expect(pickClientIp(h(spoofable), { onVercel: true, trustedProxy: false })).toBe("1.1.1.1");
    expect(pickClientIp(h({ "x-real-ip": "2.2.2.2" }), { onVercel: true, trustedProxy: false })).toBeNull();
  });
  it("behind a trusted proxy, uses what the proxy set, never the left-most X-Forwarded-For entry", () => {
    expect(pickClientIp(h(spoofable), { onVercel: false, trustedProxy: true })).toBe("10.0.0.2");
    expect(pickClientIp(h({ "x-forwarded-for": "6.6.6.6, 10.0.0.1" }), { onVercel: false, trustedProxy: true })).toBe("10.0.0.1");
  });
});

describe("shared login limit warning", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("shows only in production with password sign-in and no verifiable IP", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DASHBOARD_PASSWORD", "pw");
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("TRUSTED_PROXY", "");
    expect(sharedLoginLimitWarning()).toMatch(/TRUSTED_PROXY=true/);
    vi.stubEnv("TRUSTED_PROXY", "true");
    expect(sharedLoginLimitWarning()).toBeNull();
    vi.stubEnv("TRUSTED_PROXY", "");
    vi.stubEnv("VERCEL", "1");
    expect(sharedLoginLimitWarning()).toBeNull();
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("NODE_ENV", "development");
    expect(sharedLoginLimitWarning()).toBeNull();
  });
  it("logs once when production can't tell client IPs apart", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("TRUSTED_PROXY", "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await clientIp()).toBeNull(); // the forged x-real-ip is ignored
    expect(await clientIp()).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/TRUSTED_PROXY/);
    warn.mockRestore();
  });
});
