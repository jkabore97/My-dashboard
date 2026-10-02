"use server";

import { redirect, unstable_rethrow } from "next/navigation";
import { clearSession, clientIp, completeFirstFactor, currentUser, enrollingUser, ownerIdentity, passwordSignInEnabled, pendingUser, readSession, requireUser, writeSession } from "@/lib/server/auth";
import { safeEqual } from "@/lib/server/crypto";
import { attempt, loginLimit, succeeded, twoFactorLimit } from "@/lib/server/limits";
import { audit } from "@/lib/server/store/audit";
import { bumpSessionVersion, getUser, resetTotp, setRecoveryCodes } from "@/lib/server/store/users";
import { acceptInvite, hashPassword, inviteByToken, MIN_PASSWORD, memberPasswordHash, verifyPassword } from "@/lib/server/store/team";
import { confirmEnrollment, consumeFinishToken, createFinishToken, newRecoveryCodes, verifySecondFactor, verifyTotpOnly } from "@/lib/server/twofactor";

export interface FormState {
  error?: string;
  codes?: string[];
  finishToken?: string;
  ok?: string;
}

/** Turns infrastructure failures (e.g. database down) into a form error instead of a crash page. */
async function guarded(fn: () => Promise<FormState>): Promise<FormState> {
  try {
    return await fn();
  } catch (err) {
    unstable_rethrow(err); // let redirect() through
    console.error(err);
    return { error: "Sign-in is temporarily unavailable (the database could not be reached)." };
  }
}

export async function passwordLogin(prev: FormState, form: FormData): Promise<FormState> {
  return guarded(() => passwordLoginInner(prev, form));
}

async function passwordLoginInner(prev: FormState, form: FormData): Promise<FormState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase().slice(0, 200);
  if (email && email !== ownerIdentity()) return memberLogin(email, String(form.get("password") ?? ""));
  const password = process.env.DASHBOARD_PASSWORD;
  if (!passwordSignInEnabled() || !password) return { error: "Password sign-in is disabled." };
  const ip = await clientIp();
  const limit = loginLimit(ip, ownerIdentity());
  if (!(await attempt(limit, ownerIdentity(), ip))) return { error: "Too many attempts. Wait a while and try again." };
  const given = String(form.get("password") ?? "");
  if (!safeEqual(given, password)) {
    await audit(ownerIdentity(), "login.password.failed", null, null, ip);
    return { error: "Wrong password." };
  }
  await succeeded(limit);
  await audit(ownerIdentity(), "login.password.first_factor", null, null, ip);
  redirect(await completeFirstFactor(ownerIdentity()));
}

/** Team members sign in with their email and the password they chose from their invite. */
async function memberLogin(email: string, given: string): Promise<FormState> {
  const ip = await clientIp();
  const limit = loginLimit(ip, email);
  if (!(await attempt(limit, email, ip))) return { error: "Too many attempts. Wait a while and try again." };
  const ok = await verifyPassword(given.slice(0, 1000), await memberPasswordHash(email));
  if (!ok) {
    await audit(email, "login.password.failed", null, null, ip);
    return { error: "Wrong email or password." };
  }
  await succeeded(limit);
  await audit(email, "login.password.first_factor", null, null, ip);
  redirect(await completeFirstFactor(email));
}

/** Accepting an invite: the member picks a password, then signs in (and sets up 2FA) as usual. */
export async function acceptInviteAction(_prev: FormState, form: FormData): Promise<FormState> {
  return guarded(async () => {
    const token = String(form.get("token") ?? "");
    const password = String(form.get("password") ?? "");
    const info = await inviteByToken(token);
    if (!info || info.status !== "ok") return { error: "This invite link has expired or was already used. Ask for a new one." };
    if (password.length < MIN_PASSWORD) return { error: `Use at least ${MIN_PASSWORD} characters.` };
    if (password.length > 200) return { error: "That password is too long." };
    if (password !== String(form.get("confirm") ?? "")) return { error: "The two passwords don't match." };
    if (password.toLowerCase().includes(info.email.split("@")[0].toLowerCase())) return { error: "Don't use your email name in the password." };
    const email = await acceptInvite(token, await hashPassword(password));
    if (!email) return { error: "This invite link has expired or was already used. Ask for a new one." };
    await audit(email, "team.invite_accepted", null, null, await clientIp());
    redirect(await completeFirstFactor(email));
  });
}

export async function verifyTwoFactor(prev: FormState, form: FormData): Promise<FormState> {
  return guarded(() => verifyTwoFactorInner(prev, form));
}

async function verifyTwoFactorInner(_prev: FormState, form: FormData): Promise<FormState> {
  const email = await pendingUser();
  if (!email) redirect("/login");
  const ip = await clientIp();
  const limit = twoFactorLimit(email);
  if (!(await attempt(limit, email, ip))) return { error: "Too many attempts. Wait 10 minutes and try again." };
  const method = await verifySecondFactor(email, String(form.get("code") ?? ""));
  if (!method) {
    await audit(email, "login.2fa.failed", null, null, ip);
    return { error: "That code didn't work. Codes change every 30 seconds and can only be used once." };
  }
  await succeeded(limit);
  const user = (await getUser(email))!;
  await writeSession(email, "full", user.session_version);
  await audit(email, method === "recovery" ? "login.recovery_code_used" : "login.success", null, { remainingRecoveryCodes: method === "recovery" ? user.recovery_codes.length : undefined }, ip);
  redirect("/");
}

export async function enrollTwoFactor(_prev: FormState, form: FormData): Promise<FormState> {
  const email = await enrollingUser();
  if (!email) return { error: "Your sign-in expired. Start again." };
  const limit = twoFactorLimit(email);
  if (!(await attempt(limit, email, await clientIp()))) return { error: "Too many attempts. Wait 10 minutes and try again." };
  const codes = await confirmEnrollment(email, String(form.get("code") ?? ""));
  if (!codes) return { error: "That code didn't match. Check the time on your phone and try the newest code." };
  await succeeded(limit);
  await audit(email, "2fa.enabled", null, null, await clientIp());
  // The session is upgraded in a second step so this response can show the
  // recovery codes without the page re-rendering (cookie changes refresh it).
  return { codes, finishToken: await createFinishToken(email) };
}

export async function finishEnrollment(form: FormData) {
  const s = await readSession();
  const token = String(form.get("token") ?? "");
  if (!s || !(await consumeFinishToken(s.sub, token))) redirect("/login");
  const user = await getUser(s.sub);
  if (!user?.totp_enabled_at || user.session_version !== s.sv) redirect("/login");
  await writeSession(s.sub, "full", user.session_version);
  redirect("/");
}

export async function signOut() {
  const s = await readSession();
  if (s) await audit(s.sub, "logout");
  await clearSession();
  redirect("/login");
}

export async function signOutEverywhere() {
  const user = await requireUser();
  await bumpSessionVersion(user.email);
  await audit(user.email, "logout.everywhere", null, null, await clientIp());
  await clearSession();
  redirect("/login");
}

export async function regenerateRecoveryCodes(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const limit = twoFactorLimit(user.email);
  if (!(await attempt(limit, user.email, await clientIp()))) return { error: "Too many attempts. Wait 10 minutes." };
  if (!(await verifyTotpOnly(user.email, String(form.get("code") ?? "")))) return { error: "Enter a current code from your authenticator app." };
  await succeeded(limit);
  const { codes, hashes } = newRecoveryCodes();
  await setRecoveryCodes(user.email, hashes);
  await audit(user.email, "2fa.recovery_codes_regenerated", null, null, await clientIp());
  return { codes };
}

/** Removes 2FA and signs out everywhere; the next login re-enrolls (when required). */
export async function resetTwoFactor(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await currentUser();
  if (!user) redirect("/login");
  const limit = twoFactorLimit(user.email);
  if (!(await attempt(limit, user.email, await clientIp()))) return { error: "Too many attempts. Wait 10 minutes." };
  if (!(await verifySecondFactor(user.email, String(form.get("code") ?? "")))) return { error: "Enter a current code (or a recovery code) to confirm." };
  await succeeded(limit);
  await resetTotp(user.email);
  await bumpSessionVersion(user.email);
  await audit(user.email, "2fa.reset", null, null, await clientIp());
  await clearSession();
  redirect("/login");
}
