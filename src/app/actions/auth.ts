"use server";

import { redirect, unstable_rethrow } from "next/navigation";
import { clearSession, clientIp, completeFirstFactor, currentUser, enrollingUser, ownerIdentity, passwordSignInEnabled, pendingUser, readSession, requireUser, writeSession } from "@/lib/server/auth";
import { safeEqual } from "@/lib/server/crypto";
import { audit } from "@/lib/server/store/audit";
import { hitRateLimit } from "@/lib/server/store/ratelimit";
import { bumpSessionVersion, getUser, resetTotp, setRecoveryCodes } from "@/lib/server/store/users";
import { confirmEnrollment, consumeFinishToken, createFinishToken, newRecoveryCodes, verifySecondFactor } from "@/lib/server/twofactor";

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

async function passwordLoginInner(_prev: FormState, form: FormData): Promise<FormState> {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!passwordSignInEnabled() || !password) return { error: "Password sign-in is disabled." };
  const ip = await clientIp();
  if (!(await hitRateLimit(`login:${ip}`, 10, 15 * 60))) return { error: "Too many attempts. Wait 15 minutes and try again." };
  const given = String(form.get("password") ?? "");
  if (!safeEqual(given, password)) {
    await audit(ownerIdentity(), "login.password.failed", null, null, ip);
    return { error: "Wrong password." };
  }
  await audit(ownerIdentity(), "login.password.first_factor", null, null, ip);
  redirect(await completeFirstFactor(ownerIdentity()));
}

export async function verifyTwoFactor(prev: FormState, form: FormData): Promise<FormState> {
  return guarded(() => verifyTwoFactorInner(prev, form));
}

async function verifyTwoFactorInner(_prev: FormState, form: FormData): Promise<FormState> {
  const email = await pendingUser();
  if (!email) redirect("/login");
  const ip = await clientIp();
  if (!(await hitRateLimit(`2fa:${email}`, 6, 10 * 60))) return { error: "Too many attempts. Wait 10 minutes and try again." };
  const method = await verifySecondFactor(email, String(form.get("code") ?? ""));
  if (!method) {
    await audit(email, "login.2fa.failed", null, null, ip);
    return { error: "That code didn't work. Codes change every 30 seconds and can only be used once." };
  }
  const user = (await getUser(email))!;
  await writeSession(email, "full", user.session_version);
  await audit(email, method === "recovery" ? "login.recovery_code_used" : "login.success", null, { remainingRecoveryCodes: method === "recovery" ? user.recovery_codes.length : undefined }, ip);
  redirect("/");
}

export async function enrollTwoFactor(_prev: FormState, form: FormData): Promise<FormState> {
  const email = await enrollingUser();
  if (!email) return { error: "Your sign-in expired. Start again." };
  if (!(await hitRateLimit(`2fa:${email}`, 6, 10 * 60))) return { error: "Too many attempts. Wait 10 minutes and try again." };
  const codes = await confirmEnrollment(email, String(form.get("code") ?? ""));
  if (!codes) return { error: "That code didn't match. Check the time on your phone and try the newest code." };
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
  if (!(await hitRateLimit(`2fa:${user.email}`, 6, 10 * 60))) return { error: "Too many attempts. Wait 10 minutes." };
  if ((await verifySecondFactor(user.email, String(form.get("code") ?? ""))) !== "totp") return { error: "Enter a current code from your authenticator app." };
  const { codes, hashes } = newRecoveryCodes();
  await setRecoveryCodes(user.email, hashes);
  await audit(user.email, "2fa.recovery_codes_regenerated", null, null, await clientIp());
  return { codes };
}

/** Removes 2FA and signs out everywhere; the next login re-enrolls (when required). */
export async function resetTwoFactor(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!(await hitRateLimit(`2fa:${user.email}`, 6, 10 * 60))) return { error: "Too many attempts. Wait 10 minutes." };
  if (!(await verifySecondFactor(user.email, String(form.get("code") ?? "")))) return { error: "Enter a current code (or a recovery code) to confirm." };
  await resetTotp(user.email);
  await bumpSessionVersion(user.email);
  await audit(user.email, "2fa.reset", null, null, await clientIp());
  await clearSession();
  redirect("/login");
}
