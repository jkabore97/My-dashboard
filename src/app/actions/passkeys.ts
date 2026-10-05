"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/server";
import { clientIp, currentUser, pendingUser, readSession, require2fa, rowAllowed, writeSession } from "@/lib/server/auth";
import { attempt, passkeyLimit, passkeyRegisterLimit, passkeyStartLimit, succeeded, twoFactorLimit } from "@/lib/server/limits";
import { activeRp, assertionOptions, finishAssertion, finishRegistration, markFresh, registrationOptions, removePasskey, sessionIsFresh } from "@/lib/server/passkeys";
import { audit } from "@/lib/server/store/audit";
import { ensureUser, getUser } from "@/lib/server/store/users";
import { verifyTotpOnly } from "@/lib/server/twofactor";

// Server actions only run for same-origin POSTs (Next compares Origin with
// Host), and every ceremony is also checked against the configured origin and
// RP ID. Who is signing in comes from the passkey or the session, never from
// anything the browser says about itself.

export interface PasskeyState {
  error?: string;
  ok?: string;
  /** Adding a passkey needs a recent sign-in: confirm with a code or passkey first. */
  reauth?: boolean;
}
export type RequestOptionsResult = { options?: PublicKeyCredentialRequestOptionsJSON; error?: string };
export type CreationOptionsResult = { options?: PublicKeyCredentialCreationOptionsJSON; error?: string; reauth?: boolean };

const UNAVAILABLE = "Passkeys aren't available on this address.";
const TOO_MANY = "Too many attempts. Wait a while and try again.";

async function guarded<T extends { error?: string }>(fn: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await fn();
  } catch (err) {
    unstable_rethrow(err); // let redirect() through
    console.error(err);
    return { error: "Passkeys are temporarily unavailable. Try again, or use another way to sign in." };
  }
}

// ---------------------------------------------------------------------------
// Sign in with a passkey (no username; the passkey says who it is)

export async function passkeyLoginOptions(): Promise<RequestOptionsResult> {
  return guarded(async () => {
    const rp = await activeRp();
    if (!rp) return { error: UNAVAILABLE };
    const ip = await clientIp();
    if (!(await attempt(passkeyStartLimit(ip), "unknown", ip))) return { error: TOO_MANY };
    const options = await assertionOptions(rp, "login", null);
    return "error" in options ? { error: options.error } : { options };
  });
}

export async function passkeyLoginVerify(response: unknown): Promise<PasskeyState> {
  return guarded(async () => {
    const rp = await activeRp();
    if (!rp) return { error: UNAVAILABLE };
    const ip = await clientIp();
    const limit = passkeyLimit(ip);
    if (!(await attempt(limit, "unknown", ip))) return { error: TOO_MANY };
    const r = await finishAssertion(rp, "login", null, response);
    if ("error" in r) {
      await audit(r.email ?? "unknown", "login.passkey.failed", null, { reason: r.reason }, ip);
      return { error: r.error };
    }
    // Same checks as every other method: an environment owner, or an active member.
    const user = await getUser(r.email);
    if (!user || !rowAllowed(user, r.email)) {
      await audit(r.email, "login.passkey.denied", null, { reason: "not allowed", passkey: r.name }, ip);
      return { error: "That account can't sign in here any more. Ask the owner." };
    }
    await succeeded(limit);
    const fresh = await ensureUser(r.email); // records last_login_at
    await audit(r.email, "login.passkey", r.name, null, ip);
    // A passkey is both factors. Someone whose authenticator app was reset still sets it up again (it's the fallback).
    if (require2fa() && !fresh.totp_enabled_at) {
      await writeSession(r.email, "pending", fresh.session_version, "passkey");
      redirect("/login/2fa/setup");
    }
    await writeSession(r.email, "full", fresh.session_version, "passkey");
    redirect("/");
  });
}

// ---------------------------------------------------------------------------
// The 2FA step (after Microsoft, Google or password): a passkey instead of the code

export async function passkeySecondFactorOptions(): Promise<RequestOptionsResult> {
  return guarded(async () => {
    const email = await pendingUser();
    if (!email) return { error: "Your sign-in expired. Start again." };
    const rp = await activeRp();
    if (!rp) return { error: UNAVAILABLE };
    const ip = await clientIp();
    if (!(await attempt(passkeyStartLimit(ip), email, ip))) return { error: TOO_MANY };
    const options = await assertionOptions(rp, "second_factor", email);
    return "error" in options ? { error: options.error } : { options };
  });
}

export async function passkeySecondFactorVerify(response: unknown): Promise<PasskeyState> {
  return guarded(async () => {
    const email = await pendingUser();
    if (!email) redirect("/login");
    const rp = await activeRp();
    if (!rp) return { error: UNAVAILABLE };
    const ip = await clientIp();
    const limit = twoFactorLimit(email);
    if (!(await attempt(limit, email, ip))) return { error: "Too many attempts. Wait 10 minutes and try again." };
    // Only a passkey of the person who passed the first step counts.
    const r = await finishAssertion(rp, "second_factor", email, response);
    if ("error" in r) {
      await audit(email, "login.2fa.passkey.failed", null, { reason: r.reason }, ip);
      return { error: r.error };
    }
    await succeeded(limit);
    const user = (await getUser(email))!;
    if (require2fa() && !user.totp_enabled_at) redirect("/login/2fa/setup");
    await writeSession(email, "full", user.session_version, (await readSession())?.m);
    await audit(email, "login.2fa.passkey", r.name, null, ip);
    redirect("/");
  });
}

// ---------------------------------------------------------------------------
// Settings → Security: add, re-check, remove

async function registrant() {
  const me = await currentUser();
  if (!me) return { error: "Your session ended. Sign in again." } as const;
  if (!me.hasTotp) return { error: "Turn on two-step verification first." } as const;
  return me;
}

export async function passkeyRegisterOptions(): Promise<CreationOptionsResult> {
  return guarded(async () => {
    const me = await registrant();
    if ("error" in me) return { error: me.error };
    const rp = await activeRp();
    if (!rp) return { error: UNAVAILABLE };
    if (!(await sessionIsFresh(await readSession()))) return { reauth: true, error: "For your security, confirm it's you first." };
    if (!(await attempt(passkeyRegisterLimit(me.email), me.email, await clientIp()))) return { error: TOO_MANY };
    const options = await registrationOptions(rp, { email: me.email, name: me.name });
    return "error" in options ? { error: options.error } : { options };
  });
}

export async function passkeyRegisterVerify(response: unknown, name: unknown): Promise<PasskeyState> {
  return guarded(async () => {
    const me = await registrant();
    if ("error" in me) return { error: me.error };
    const rp = await activeRp();
    if (!rp) return { error: UNAVAILABLE };
    if (!(await sessionIsFresh(await readSession()))) return { reauth: true, error: "For your security, confirm it's you first." };
    const ip = await clientIp();
    const r = await finishRegistration(rp, me.email, response, name);
    if ("error" in r) {
      await audit(me.email, "passkey.register.failed", null, { reason: r.reason }, ip);
      return { error: r.error };
    }
    await succeeded(passkeyRegisterLimit(me.email));
    await audit(me.email, "passkey.register", r.ok, null, ip);
    revalidatePath("/settings");
    return { ok: `Added “${r.ok}”. Next time, choose “Sign in with a passkey”.` };
  });
}

/** Re-check with an authenticator code before adding a passkey. */
export async function passkeyReauthWithCode(_prev: PasskeyState, form: FormData): Promise<PasskeyState> {
  return guarded(async () => {
    const me = await registrant();
    if ("error" in me) return { error: me.error };
    const s = await readSession();
    if (!s) return { error: "Your session ended. Sign in again." };
    const ip = await clientIp();
    const limit = twoFactorLimit(me.email);
    if (!(await attempt(limit, me.email, ip))) return { error: "Too many attempts. Wait 10 minutes." };
    if (!(await verifyTotpOnly(me.email, String(form.get("code") ?? "").slice(0, 20)))) return { reauth: true, error: "That code didn't work. Enter the current one from your authenticator app." };
    await succeeded(limit);
    await markFresh(me.email, s.sv);
    await audit(me.email, "passkey.reauth", null, { with: "totp" }, ip);
    return { ok: "Confirmed. You can add a passkey for the next 10 minutes." };
  });
}

/** Re-check with an existing passkey before adding another. */
export async function passkeyReauthOptions(): Promise<RequestOptionsResult> {
  return guarded(async () => {
    const me = await registrant();
    if ("error" in me) return { error: me.error };
    const rp = await activeRp();
    if (!rp) return { error: UNAVAILABLE };
    const options = await assertionOptions(rp, "reauth", me.email);
    return "error" in options ? { error: options.error } : { options };
  });
}

export async function passkeyReauthVerify(response: unknown): Promise<PasskeyState> {
  return guarded(async () => {
    const me = await registrant();
    if ("error" in me) return { error: me.error };
    const s = await readSession();
    const rp = await activeRp();
    if (!rp || !s) return { error: UNAVAILABLE };
    const ip = await clientIp();
    const limit = twoFactorLimit(me.email);
    if (!(await attempt(limit, me.email, ip))) return { error: "Too many attempts. Wait 10 minutes." };
    const r = await finishAssertion(rp, "reauth", me.email, response);
    if ("error" in r) {
      await audit(me.email, "passkey.reauth.failed", null, { reason: r.reason }, ip);
      return { reauth: true, error: r.error };
    }
    await succeeded(limit);
    await markFresh(me.email, s.sv);
    await audit(me.email, "passkey.reauth", r.name, { with: "passkey" }, ip);
    return { ok: "Confirmed. You can add a passkey for the next 10 minutes." };
  });
}

export async function removePasskeyAction(id: string): Promise<PasskeyState> {
  return guarded(async () => {
    const me = await currentUser();
    if (!me) redirect("/login");
    const name = await removePasskey(me.email, String(id ?? "").slice(0, 1400));
    if (!name) return { error: "That passkey was already removed." };
    await audit(me.email, "passkey.remove", name, null, await clientIp());
    revalidatePath("/settings");
    return { ok: `Removed “${name}”. Also delete it from your device's password manager.` };
  });
}
