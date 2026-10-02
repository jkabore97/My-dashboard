"use client";

import { useFormState } from "@/components/useFormState";

import { acceptInviteAction, enrollTwoFactor, finishEnrollment, passwordLogin, verifyTwoFactor } from "@/app/actions/auth";
import { RecoveryCodes } from "./RecoveryCodes";

const input = "hud-input min-h-11 w-full px-3 py-2.5 text-[15px] placeholder:text-muted/70";
const codeInput = "hud-input min-h-14 w-full px-4 py-3 text-center font-mono text-2xl tracking-[0.45em] placeholder:text-muted/40 placeholder:tracking-[0.3em]";
const label = "hud-label mb-1.5 block text-[11px] text-muted";
const button = "hud-btn hud-btn-solid mt-5 min-h-12 w-full text-[13px]";

export function PasswordForm({ withEmail = false, ownerPassword = true }: { withEmail?: boolean; ownerPassword?: boolean }) {
  const [state, action, pending] = useFormState(passwordLogin, {});
  return (
    <form onSubmit={action}>
      {withEmail && (
        <>
          <label className={label} htmlFor="email">Email{ownerPassword && <span className="normal-case tracking-normal"> (team members; leave empty for the owner password)</span>}</label>
          <input id="email" name="email" type="email" autoComplete="username" required={!ownerPassword} className={`${input} mb-3`} />
        </>
      )}
      <label className={label} htmlFor="password">Password</label>
      <input id="password" name="password" type="password" autoComplete="current-password" required className={input} />
      {state.error && <p className="mt-2 text-sm text-critical">{state.error}</p>}
      <button disabled={pending} className={button}>{pending ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}

export function TwoFactorForm() {
  const [state, action, pending] = useFormState(verifyTwoFactor, {});
  return (
    <form onSubmit={action}>
      <label className={label} htmlFor="code">6-digit code or a recovery code</label>
      <input id="code" name="code" autoComplete="one-time-code" autoFocus required maxLength={20} placeholder="000000" className={codeInput} />
      {state.error && <p className="mt-2 text-sm text-critical">{state.error}</p>}
      <button disabled={pending} className={button}>{pending ? "Checking…" : "Verify"}</button>
    </form>
  );
}

export function EnrollForm() {
  const [state, action, pending] = useFormState(enrollTwoFactor, {});
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
    <form onSubmit={action} className="mt-4">
      <label className={label} htmlFor="code">Enter the 6-digit code it shows</label>
      <input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" required placeholder="000000" className={codeInput} />
      {state.error && <p className="mt-2 text-sm text-critical">{state.error}</p>}
      <button disabled={pending} className={button}>{pending ? "Checking…" : "Turn on 2FA"}</button>
    </form>
  );
}

export function AcceptInviteForm({ token, email }: { token: string; email: string }) {
  const [state, action, pending] = useFormState(acceptInviteAction, {});
  return (
    <form onSubmit={action}>
      <input type="hidden" name="token" value={token} />
      <input type="email" name="username" value={email} autoComplete="username" readOnly hidden />
      <label className={label} htmlFor="password">Choose a password (12+ characters)</label>
      <input id="password" name="password" type="password" autoComplete="new-password" minLength={12} required className={`${input} mb-3`} />
      <label className={label} htmlFor="confirm">Type it again</label>
      <input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={12} required className={input} />
      {state.error && <p className="mt-2 text-sm text-critical">{state.error}</p>}
      <button disabled={pending} className={button}>{pending ? "Saving…" : "Set password and continue"}</button>
      <p className="mt-3 text-[13px] text-muted">Next you&apos;ll set up an authenticator app; it&apos;s required for everyone.</p>
    </form>
  );
}
