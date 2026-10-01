"use client";

import { useActionState } from "react";
import { enrollTwoFactor, finishEnrollment, passwordLogin, verifyTwoFactor } from "@/app/actions/auth";
import { RecoveryCodes } from "./RecoveryCodes";

const input = "w-full rounded-lg border border-line bg-bg px-3 py-2 outline-none focus:border-accent";
const button = "mt-4 w-full rounded-lg bg-accent px-3 py-2 font-medium text-bg hover:opacity-90 disabled:opacity-50";

export function PasswordForm() {
  const [state, action, pending] = useActionState(passwordLogin, {});
  return (
    <form action={action}>
      <label className="mb-1 block text-sm text-muted" htmlFor="password">Password</label>
      <input id="password" name="password" type="password" autoComplete="current-password" required className={input} />
      {state.error && <p className="mt-2 text-sm text-critical">{state.error}</p>}
      <button disabled={pending} className={button}>{pending ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}

export function TwoFactorForm() {
  const [state, action, pending] = useActionState(verifyTwoFactor, {});
  return (
    <form action={action}>
      <label className="mb-1 block text-sm text-muted" htmlFor="code">6-digit code or a recovery code</label>
      <input id="code" name="code" autoComplete="one-time-code" autoFocus required maxLength={20} className={`${input} tracking-widest`} />
      {state.error && <p className="mt-2 text-sm text-critical">{state.error}</p>}
      <button disabled={pending} className={button}>{pending ? "Checking…" : "Verify"}</button>
    </form>
  );
}

export function EnrollForm() {
  const [state, action, pending] = useActionState(enrollTwoFactor, {});
  if (state.codes) {
    return (
      <div className="mt-4">
        <RecoveryCodes codes={state.codes} />
        <form action={finishEnrollment}>
          <input type="hidden" name="token" value={state.finishToken} />
          <button className={button}>I saved them — continue</button>
        </form>
      </div>
    );
  }
  return (
    <form action={action} className="mt-4">
      <label className="mb-1 block text-sm text-muted" htmlFor="code">Enter the 6-digit code it shows</label>
      <input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" required className={`${input} tracking-widest`} />
      {state.error && <p className="mt-2 text-sm text-critical">{state.error}</p>}
      <button disabled={pending} className={button}>{pending ? "Checking…" : "Turn on 2FA"}</button>
    </form>
  );
}
