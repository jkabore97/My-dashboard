import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { env } from "../source";
import { PENDING_TTL_SECONDS, SESSION_COOKIE, SESSION_TTL_SECONDS, sessionSecret, signSession, verifySession, type SessionPayload } from "../session";
import { isProduction } from "./db";
import { ensureUser, getUser } from "./store/users";

export interface CurrentUser {
  email: string;
  hasTotp: boolean;
}

/** Identity used for password sign-in. Set OWNER_EMAIL to share 2FA with Google sign-in. */
export const ownerIdentity = () => (env("OWNER_EMAIL") ?? "owner").toLowerCase();

export const allowedEmails = () =>
  (env("ALLOWED_EMAILS") ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

export function isAllowed(email: string) {
  const e = email.toLowerCase();
  return (!!env("DASHBOARD_PASSWORD") && e === ownerIdentity()) || allowedEmails().includes(e);
}

/** 2FA is mandatory unless explicitly disabled with REQUIRE_2FA=false. */
export const require2fa = () => env("REQUIRE_2FA") !== "false";

export const googleSignInEnabled = () => !!(env("GOOGLE_CLIENT_ID") && env("GOOGLE_CLIENT_SECRET") && allowedEmails().length);
export const passwordSignInEnabled = () => !!env("DASHBOARD_PASSWORD");

/** The caller's IP, or null when no trustworthy source for it exists. */
export async function clientIp(): Promise<string | null> {
  return pickClientIp(await headers(), { onVercel: !!process.env.VERCEL, trustedProxy: env("TRUSTED_PROXY") === "true" });
}

/**
 * Every forwarding header can be set by the client unless a proxy in front of
 * the app overwrites it. On Vercel the platform sets x-vercel-forwarded-for.
 * Elsewhere x-real-ip / the last X-Forwarded-For entry are only meaningful
 * when TRUSTED_PROXY=true says a reverse proxy sets them; otherwise the IP is
 * unknown (null) rather than attacker-chosen.
 */
export function pickClientIp(h: Pick<Headers, "get">, o: { onVercel: boolean; trustedProxy: boolean }): string | null {
  if (o.onVercel) return h.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() || null;
  if (o.trustedProxy) return h.get("x-real-ip")?.trim() || h.get("x-forwarded-for")?.split(",").at(-1)?.trim() || null;
  return null;
}

export async function readSession(): Promise<SessionPayload | null> {
  const secret = sessionSecret();
  if (!secret) return null;
  return verifySession((await cookies()).get(SESSION_COOKIE)?.value, secret);
}

export async function writeSession(email: string, stage: SessionPayload["stage"], sessionVersion: number) {
  const secret = sessionSecret();
  if (!secret) throw new Error("SESSION_SECRET must be set (32+ characters)");
  const ttl = stage === "full" ? SESSION_TTL_SECONDS : PENDING_TTL_SECONDS;
  (await cookies()).set(SESSION_COOKIE, await signSession({ sub: email, stage, sv: sessionVersion }, ttl, secret), {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax",
    path: "/",
    maxAge: ttl,
  });
}

export async function clearSession() {
  (await cookies()).delete(SESSION_COOKIE);
}

/**
 * Full validation for pages, server actions and API routes: a signed full
 * session, an allowed identity, and a session version that hasn't been
 * revoked ("sign out everywhere"). The proxy only checks the signature.
 */
export async function currentUser(): Promise<CurrentUser | null> {
  const s = await readSession();
  if (!s || s.stage !== "full" || !isAllowed(s.sub)) return null;
  const user = await getUser(s.sub);
  if (!user || user.session_version !== s.sv) return null;
  if (require2fa() && !user.totp_enabled_at) return null;
  return { email: s.sub, hasTotp: !!user.totp_enabled_at };
}

export async function requireUser(): Promise<CurrentUser> {
  const u = await currentUser();
  if (!u) redirect("/login");
  return u;
}

/** The first-factor-passed identity during 2FA (pending session). */
export async function pendingUser(): Promise<string | null> {
  const s = await readSession();
  if (!s || s.stage !== "pending" || !isAllowed(s.sub)) return null;
  const user = await getUser(s.sub);
  return user && user.session_version === s.sv ? s.sub : null;
}

/** After password or Google sign-in: decide whether 2FA is owed. Returns where to go next. */
export async function completeFirstFactor(email: string): Promise<string> {
  const user = await ensureUser(email.toLowerCase());
  if (user.totp_enabled_at) {
    await writeSession(user.email, "pending", user.session_version);
    return "/login/2fa";
  }
  if (require2fa()) {
    await writeSession(user.email, "pending", user.session_version);
    return "/login/2fa/setup";
  }
  await writeSession(user.email, "full", user.session_version);
  return "/";
}

/** Who may enroll in 2FA: someone mid-login without it, or a signed-in user turning it on. */
export async function enrollingUser(): Promise<string | null> {
  const s = await readSession();
  if (!s || !isAllowed(s.sub)) return null;
  const u = await getUser(s.sub);
  if (!u || u.totp_enabled_at || u.session_version !== s.sv) return null;
  return s.sub;
}
