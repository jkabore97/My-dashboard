import { randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { sessionSecret, signSession, verifySession, type SessionPayload } from "../session";
import { randomToken, safeEqual, sha256Hex } from "./crypto";
import { getDb, isProduction } from "./db";
import { passkeyRp, passkeysSwitchedOn, type PasskeyRp } from "./passkey-config";

// Passkeys (WebAuthn). A person adds one from Settings → Security after a full
// sign-in with 2FA. Afterwards a passkey signs them in on its own (it is two
// factors at once: the device, and the face/fingerprint/PIN that unlocks it),
// or replaces the authenticator code on the 2FA step.

export type ChallengeFlow = "register" | "login" | "second_factor" | "reauth";

/** How long a challenge (and the browser prompt for it) lives. */
export const CHALLENGE_TTL_SECONDS = 5 * 60;
/** Adding a passkey needs a sign-in (or a re-check) this recent. */
export const FRESH_SECONDS = 10 * 60;
export const MAX_PASSKEYS = 20;
const NAME_MAX = 60;

const challengeCookie = (flow: ChallengeFlow) => `kcc_wa_${flow}`;
const REAUTH_COOKIE = "kcc_reauth";

/** The relying party for this request, or null when passkeys are off or can't work here. */
export async function activeRp(): Promise<PasskeyRp | null> {
  if (!passkeysSwitchedOn()) return null;
  return passkeyRp((await headers()).get("host"));
}

/**
 * Whether to offer passkeys on this page: on, and served from the RP's own
 * host (a Vercel preview URL can't use passkeys bound to the production domain).
 */
export async function passkeysUsableHere(): Promise<boolean> {
  const rp = await activeRp();
  if (!rp) return false;
  const host = (await headers()).get("host");
  if (!host) return true;
  try {
    return new URL(`http://${host}`).hostname === rp.rpID;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Storage

interface PasskeyRow {
  id: string;
  user_email: string;
  public_key: string;
  counter: string | number;
  transports: string[];
  name: string;
  device_type: string;
  backed_up: boolean;
  created_at: Date | string;
  last_used_at: Date | string | null;
}

export interface PasskeySummary {
  id: string;
  name: string;
  /** Synced (iCloud Keychain, Google Password Manager…) or bound to one device/key. */
  synced: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

const iso = (v: Date | string | null) => (v == null ? null : new Date(v).toISOString());

export async function listPasskeys(email: string): Promise<PasskeySummary[]> {
  const db = await getDb();
  const rows = await db.query<PasskeyRow>("select * from passkeys where user_email = $1 order by created_at", [email]);
  return rows.map((r) => ({ id: r.id, name: r.name, synced: r.device_type === "multiDevice" || r.backed_up, createdAt: iso(r.created_at)!, lastUsedAt: iso(r.last_used_at) }));
}

export async function countPasskeys(email: string): Promise<number> {
  const db = await getDb();
  const [row] = await db.query<{ n: number }>("select count(*)::int as n from passkeys where user_email = $1", [email]);
  return Number(row?.n ?? 0);
}

/** Passkeys per person, for the Team page. */
export async function passkeyCounts(): Promise<Map<string, number>> {
  const db = await getDb();
  const rows = await db.query<{ user_email: string; n: number }>("select user_email, count(*)::int as n from passkeys group by user_email");
  return new Map(rows.map((r) => [r.user_email, Number(r.n)]));
}

/** Removes one of this person's passkeys. The email comes from the session, never the client. */
export async function removePasskey(email: string, id: string): Promise<string | null> {
  const db = await getDb();
  const [row] = await db.query<{ name: string }>("delete from passkeys where id = $1 and user_email = $2 returning name", [id, email]);
  return row?.name ?? null;
}

export async function removeAllPasskeys(email: string): Promise<number> {
  const db = await getDb();
  return (await db.query("delete from passkeys where user_email = $1 returning id", [email])).length;
}

/** The random WebAuthn user handle for a person, created on first use. */
async function webauthnId(email: string): Promise<string> {
  const db = await getDb();
  await db.query("update users set webauthn_id = $2 where email = $1 and webauthn_id is null", [email, randomBytes(32).toString("base64url")]);
  const [row] = await db.query<{ webauthn_id: string }>("select webauthn_id from users where email = $1", [email]);
  if (!row?.webauthn_id) throw new Error("No such user");
  return row.webauthn_id;
}

// ---------------------------------------------------------------------------
// Challenges: single use, short-lived, bound to this browser, one flow and (except sign-in) one person.

async function saveChallenge(flow: ChallengeFlow, challenge: string, email: string | null): Promise<void> {
  const handle = randomToken(32);
  const db = await getDb();
  await db.query("delete from webauthn_challenges where expires_at < now() - interval '1 minute'");
  await db.query(
    "insert into webauthn_challenges (handle_hash, flow, challenge, user_email, expires_at) values ($1, $2, $3, $4, now() + make_interval(secs => $5))",
    [sha256Hex(`kcc-webauthn:${handle}`), flow, challenge, email, CHALLENGE_TTL_SECONDS],
  );
  (await cookies()).set(challengeCookie(flow), handle, { httpOnly: true, secure: isProduction(), sameSite: "strict", path: "/", maxAge: CHALLENGE_TTL_SECONDS });
}

/**
 * Takes this browser's challenge for a flow out of the database (so it can't
 * be used twice, even when the attempt fails). Null when missing, expired,
 * for another flow, or issued to someone else.
 */
async function takeChallenge(flow: ChallengeFlow, email: string | null): Promise<string | null> {
  const jar = await cookies();
  const handle = jar.get(challengeCookie(flow))?.value;
  jar.delete(challengeCookie(flow));
  if (!handle || handle.length > 100) return null;
  const db = await getDb();
  const [row] = await db.query<{ flow: string; challenge: string; user_email: string | null; live: boolean }>(
    "delete from webauthn_challenges where handle_hash = $1 returning flow, challenge, user_email, expires_at > now() as live",
    [sha256Hex(`kcc-webauthn:${handle}`)],
  );
  if (!row || !row.live || row.flow !== flow) return null;
  if ((row.user_email ?? null) !== (email ?? null)) return null;
  return row.challenge;
}

// ---------------------------------------------------------------------------
// Freshness: adding a passkey needs a recent sign-in, or a re-check.

const reauthSecret = (s: string) => `${s}|kcc-reauth`;

/** True when the session was made in the last 10 minutes, or the person re-checked with a code or passkey since. */
export async function sessionIsFresh(s: Pick<SessionPayload, "sub" | "sv" | "iat"> | null): Promise<boolean> {
  if (!s) return false;
  if (Date.now() / 1000 - s.iat <= FRESH_SECONDS) return true;
  const secret = sessionSecret();
  if (!secret) return false;
  const proof = await verifySession((await cookies()).get(REAUTH_COOKIE)?.value, reauthSecret(secret));
  return !!proof && proof.sub === s.sub && proof.sv === s.sv;
}

export async function markFresh(email: string, sessionVersion: number) {
  const secret = sessionSecret();
  if (!secret) throw new Error("SESSION_SECRET must be set (32+ characters)");
  // Signed with a derived key, so this cookie can never pass as a session.
  const token = await signSession({ sub: email, stage: "full", sv: sessionVersion }, FRESH_SECONDS, reauthSecret(secret));
  (await cookies()).set(REAUTH_COOKIE, token, { httpOnly: true, secure: isProduction(), sameSite: "strict", path: "/", maxAge: FRESH_SECONDS });
}

// ---------------------------------------------------------------------------
// Registration

export async function registrationOptions(rp: PasskeyRp, user: { email: string; name: string }): Promise<PublicKeyCredentialCreationOptionsJSON | { error: string }> {
  const db = await getDb();
  const existing = await db.query<{ id: string; transports: string[] }>("select id, transports from passkeys where user_email = $1", [user.email]);
  if (existing.length >= MAX_PASSKEYS) return { error: `You already have ${MAX_PASSKEYS} passkeys. Remove one first.` };
  const options = await generateRegistrationOptions({
    rpName: rp.rpName,
    rpID: rp.rpID,
    userName: user.email,
    userDisplayName: user.name,
    userID: new Uint8Array(Buffer.from(await webauthnId(user.email), "base64url")),
    timeout: CHALLENGE_TTL_SECONDS * 1000,
    attestationType: "none",
    excludeCredentials: existing.map((c) => ({ id: c.id, transports: Array.isArray(c.transports) ? c.transports : [] })),
    authenticatorSelection: { residentKey: "required", requireResidentKey: true, userVerification: "required" },
  });
  await saveChallenge("register", options.challenge, user.email);
  return options;
}

export const cleanName = (raw: unknown) => String(raw ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, NAME_MAX);

export async function finishRegistration(rp: PasskeyRp, email: string, response: unknown, rawName: unknown): Promise<{ ok: string } | { error: string; reason: string }> {
  const challenge = await takeChallenge("register", email);
  if (!challenge) return { error: "That took too long or was already used. Try again.", reason: "challenge" };
  if (!isCredentialJson(response) || !response.response || typeof response.response !== "object") return { error: "Your browser sent an unexpected answer. Try again.", reason: "shape" };
  let info;
  try {
    const v = await verifyRegistrationResponse({
      response: response as unknown as RegistrationResponseJSON,
      expectedChallenge: challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      requireUserVerification: true,
    });
    if (!v.verified || !v.registrationInfo) return { error: "The passkey couldn't be verified. Try again.", reason: "unverified" };
    info = v.registrationInfo;
  } catch (err) {
    return { error: "The passkey couldn't be verified. Try again.", reason: err instanceof Error ? err.message.slice(0, 200) : "error" };
  }
  if (!info.userVerified) return { error: "Your device must check it's you (Face ID, fingerprint or PIN).", reason: "no user verification" };
  const name = cleanName(rawName) || (info.credentialDeviceType === "multiDevice" ? "Synced passkey" : "Security key");
  const db = await getDb();
  if ((await countPasskeys(email)) >= MAX_PASSKEYS) return { error: `You already have ${MAX_PASSKEYS} passkeys. Remove one first.`, reason: "limit" };
  const rows = await db.query(
    `insert into passkeys (id, user_email, public_key, counter, transports, name, device_type, backed_up, aaguid)
     values ($1, $2, $3, $4, $5::text::jsonb, $6, $7, $8, $9) on conflict (id) do nothing returning id`,
    [
      info.credential.id,
      email,
      Buffer.from(info.credential.publicKey).toString("base64url"),
      info.credential.counter ?? 0,
      JSON.stringify((info.credential.transports ?? []).map(String).slice(0, 10)),
      name,
      info.credentialDeviceType === "multiDevice" ? "multiDevice" : "singleDevice",
      !!info.credentialBackedUp,
      info.aaguid ?? null,
    ],
  );
  if (!rows.length) return { error: "That passkey is already registered.", reason: "duplicate" };
  return { ok: name };
}

// ---------------------------------------------------------------------------
// Assertions: sign-in (any passkey, no username), the 2FA step and re-checks (this person's passkeys only)

export async function assertionOptions(rp: PasskeyRp, flow: Exclude<ChallengeFlow, "register">, email: string | null): Promise<PublicKeyCredentialRequestOptionsJSON | { error: string }> {
  let allow: { id: string; transports?: string[] }[] | undefined;
  if (flow !== "login") {
    if (!email) return { error: "Your sign-in expired. Start again." };
    const db = await getDb();
    const rows = await db.query<{ id: string; transports: string[] }>("select id, transports from passkeys where user_email = $1", [email]);
    if (!rows.length) return { error: "You don't have a passkey yet." };
    allow = rows.map((r) => ({ id: r.id, transports: Array.isArray(r.transports) ? r.transports : [] }));
  }
  const options = await generateAuthenticationOptions({
    rpID: rp.rpID,
    userVerification: "required",
    timeout: CHALLENGE_TTL_SECONDS * 1000,
    ...(allow ? { allowCredentials: allow } : {}),
  });
  await saveChallenge(flow, options.challenge, flow === "login" ? null : email);
  return options;
}

export type AssertionResult = { email: string; credentialId: string; name: string } | { error: string; reason: string; email?: string };

function isCredentialJson(x: unknown): x is { id: string; rawId: string; type: string; response: Record<string, unknown> } {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return typeof o.id === "string" && o.id.length > 0 && o.id.length <= 1400 && /^[A-Za-z0-9_-]+$/.test(o.id) && typeof o.rawId === "string" && o.type === "public-key" && !!o.response && typeof o.response === "object";
}

/**
 * Verifies an assertion. For sign-in, `email` is null and the passkey decides
 * who it is; otherwise the passkey must belong to `email` (the person the
 * challenge was issued to). Checks origin, RP ID, user verification, the user
 * handle and the signature counter, then records the use.
 */
export async function finishAssertion(rp: PasskeyRp, flow: Exclude<ChallengeFlow, "register">, email: string | null, response: unknown): Promise<AssertionResult> {
  const generic = "That passkey didn't work. Try again, or use another way to sign in.";
  const challenge = await takeChallenge(flow, email);
  if (!challenge) return { error: "That took too long or was already used. Try again.", reason: "challenge" };
  if (!isCredentialJson(response)) return { error: generic, reason: "shape" };
  const db = await getDb();
  const [row] = await db.query<PasskeyRow & { webauthn_id: string | null }>(
    "select p.*, u.webauthn_id from passkeys p join users u on u.email = p.user_email where p.id = $1",
    [response.id],
  );
  if (!row) return { error: generic, reason: "unknown credential" };
  if (email !== null && row.user_email !== email) return { error: generic, reason: "credential of another user", email };
  const userHandle = (response.response as { userHandle?: unknown }).userHandle;
  if (typeof userHandle === "string" && userHandle && (!row.webauthn_id || !safeEqual(userHandle, row.webauthn_id))) {
    return { error: generic, reason: "user handle mismatch", email: row.user_email };
  }
  if (flow === "login" && !userHandle) return { error: generic, reason: "no user handle", email: row.user_email };
  const stored = Number(row.counter);
  let info;
  try {
    const v = await verifyAuthenticationResponse({
      response: response as unknown as AuthenticationResponseJSON,
      expectedChallenge: challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      credential: { id: row.id, publicKey: new Uint8Array(Buffer.from(row.public_key, "base64url")), counter: stored, transports: Array.isArray(row.transports) ? row.transports : [] },
      requireUserVerification: true,
    });
    if (!v.verified) return { error: generic, reason: "unverified", email: row.user_email };
    info = v.authenticationInfo;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "error";
    return { error: generic, reason: /counter/i.test(msg) ? "counter regression" : msg.slice(0, 200), email: row.user_email };
  }
  if (!info.userVerified) return { error: generic, reason: "no user verification", email: row.user_email };
  if (info.credentialID !== row.id) return { error: generic, reason: "credential id mismatch", email: row.user_email };
  const next = Number(info.newCounter ?? 0);
  // A counter that doesn't go up (when either side uses one) means a cloned authenticator.
  if ((stored > 0 || next > 0) && next <= stored) return { error: generic, reason: "counter regression", email: row.user_email };
  const updated = await db.query(
    "update passkeys set counter = $2, last_used_at = now(), backed_up = $3 where id = $1 and counter = $4 returning id",
    [row.id, next, !!info.credentialBackedUp, stored],
  );
  if (!updated.length) return { error: generic, reason: "counter changed concurrently", email: row.user_email };
  return { email: row.user_email, credentialId: row.id, name: row.name };
}
