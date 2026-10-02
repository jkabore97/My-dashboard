import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { env } from "../source";
import { PENDING_TTL_SECONDS, SESSION_COOKIE, SESSION_TTL_SECONDS, sessionSecret, signSession, verifySession, type SessionPayload } from "../session";
import { isProduction } from "./db";
import { ensureUser, getUser, type UserRow } from "./store/users";
import { canSee, inBusiness, isFullOwner, OWNER_ACCESS, type Access, type Role, type Section } from "../access";

export interface CurrentUser extends Access {
  email: string;
  hasTotp: boolean;
  /** Display name (team members), else the email. */
  name: string;
  /** True for owners configured in the environment (they can't be edited from the Team page). */
  envOwner: boolean;
}

/** Identity used for password sign-in. Set OWNER_EMAIL to share 2FA with Google sign-in. */
export const ownerIdentity = () => (env("OWNER_EMAIL") ?? "owner").toLowerCase();

export const allowedEmails = () =>
  (env("ALLOWED_EMAILS") ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

/** Owners configured in the environment: the password identity and ALLOWED_EMAILS. */
export function isEnvOwner(email: string) {
  const e = email.toLowerCase();
  return (passwordSignInEnabled() && e === ownerIdentity()) || allowedEmails().includes(e);
}

/** Whether a user row may sign in: an environment owner, or an active team member. */
export const rowAllowed = (row: Pick<UserRow, "email" | "role" | "disabled_at"> | null, email: string) =>
  isEnvOwner(email) || (!!row?.role && !row.disabled_at);

/** Environment owner or active team member. */
export async function isAllowed(email: string): Promise<boolean> {
  if (isEnvOwner(email)) return true;
  return rowAllowed(await getUser(email.toLowerCase()), email);
}

/** Role and businesses for a signed-in row. Environment owners always get everything. */
export function accessFor(row: Pick<UserRow, "email" | "role" | "businesses">): Access {
  if (isEnvOwner(row.email)) return OWNER_ACCESS;
  return { role: (row.role ?? "owner") as Role, businesses: Array.isArray(row.businesses) ? row.businesses : null };
}

/** 2FA is mandatory unless explicitly disabled with REQUIRE_2FA=false. */
export const require2fa = () => env("REQUIRE_2FA") !== "false";

export type SignInMethod = "microsoft" | "google" | "password";

/**
 * SIGN_IN_METHODS limits how anyone can sign in, e.g. "microsoft" for
 * Microsoft only. Unset: every method that's configured.
 */
export function signInMethods(): SignInMethod[] | null {
  const raw = env("SIGN_IN_METHODS");
  if (!raw) return null;
  return raw.split(",").map((m) => m.trim().toLowerCase()).filter((m): m is SignInMethod => m === "microsoft" || m === "google" || m === "password");
}
const methodOn = (m: SignInMethod) => signInMethods()?.includes(m) ?? true;

/** Microsoft sign-in works for ALLOWED_EMAILS and for invited team members. Uses the MS_CLIENT_ID app. */
export const microsoftSignInEnabled = () => methodOn("microsoft") && !!(env("MS_CLIENT_ID") && env("MS_CLIENT_SECRET"));
/** Google sign-in works for ALLOWED_EMAILS and for invited team members. */
export const googleSignInEnabled = () => methodOn("google") && !!(env("GOOGLE_CLIENT_ID") && env("GOOGLE_CLIENT_SECRET"));
/** The owner password (DASHBOARD_PASSWORD) and team members' own passwords. */
export const passwordSignInEnabled = () => methodOn("password") && !!env("DASHBOARD_PASSWORD");
/** Whether invited members may set a password (off when sign-in is limited to Microsoft/Google). */
export const memberPasswordsEnabled = () => methodOn("password");

/** Whether this deployment can know a caller's real IP (see pickClientIp). */
export const clientIpVerifiable = () => !!process.env.VERCEL || env("TRUSTED_PROXY") === "true";

/** Shown in Settings when password sign-in falls back to the shared limit for unknown IPs. */
export const sharedLoginLimitWarning = () =>
  isProduction() && passwordSignInEnabled() && !clientIpVerifiable()
    ? "Client IPs can't be verified, so password sign-in uses one shared rate limit that anyone can exhaust. Set TRUSTED_PROXY=true behind a proxy that sets X-Real-IP, or deploy on Vercel."
    : null;

let warnedNoIp = false;

/** The caller's IP, or null when no trustworthy source for it exists. */
export async function clientIp(): Promise<string | null> {
  const ip = pickClientIp(await headers(), { onVercel: !!process.env.VERCEL, trustedProxy: env("TRUSTED_PROXY") === "true" });
  if (ip === null && isProduction() && !warnedNoIp) {
    warnedNoIp = true;
    console.warn(
      clientIpVerifiable()
        ? "[auth] A request arrived without the expected client-IP header; it shares the sign-in limit for unknown IPs."
        : "[auth] Client IPs can't be verified (not on Vercel, TRUSTED_PROXY unset), so password sign-in uses one shared rate limit that anyone can exhaust. Set TRUSTED_PROXY=true behind a proxy that sets X-Real-IP.",
    );
  }
  return ip;
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
  if (!s || s.stage !== "full") return null;
  const user = await getUser(s.sub);
  if (!user || !rowAllowed(user, s.sub) || user.session_version !== s.sv) return null;
  if (require2fa() && !user.totp_enabled_at) return null;
  return { email: s.sub, hasTotp: !!user.totp_enabled_at, name: user.name || s.sub, envOwner: isEnvOwner(s.sub), ...accessFor(user) };
}

export async function requireUser(): Promise<CurrentUser> {
  const u = await currentUser();
  if (!u) redirect("/login");
  return u;
}

/** For pages and actions: the signed-in user, if their role includes this section. Others go to the Overview. */
export async function requireSection(section: Section): Promise<CurrentUser> {
  const u = await requireUser();
  if (!canSee(u, section)) redirect("/?denied=1");
  return u;
}

/** Connections, settings and the team: owners who see every business. */
export async function requireOwner(): Promise<CurrentUser> {
  const u = await requireUser();
  if (!isFullOwner(u)) redirect("/?denied=1");
  return u;
}

/** The first-factor-passed identity during 2FA (pending session). */
export async function pendingUser(): Promise<string | null> {
  const s = await readSession();
  if (!s || s.stage !== "pending") return null;
  const user = await getUser(s.sub);
  return user && rowAllowed(user, s.sub) && user.session_version === s.sv ? s.sub : null;
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
  if (!s) return null;
  const u = await getUser(s.sub);
  if (!u || !rowAllowed(u, s.sub) || u.totp_enabled_at || u.session_version !== s.sv) return null;
  return s.sub;
}

/**
 * For actions that change a business's records: the user must have the
 * section, and both the record's current business (when it exists) and the
 * business it's being saved under must be theirs. Returns an error message,
 * or null when allowed.
 */
export function businessDenied(u: Access, ...businesses: (string | null | undefined)[]): string | null {
  for (const b of businesses) {
    if (b === undefined) continue;
    if (!inBusiness(u, b)) return u.businesses?.length ? `You can only work with ${u.businesses.join(", ")}.` : "You don't have access to that business.";
  }
  return null;
}
