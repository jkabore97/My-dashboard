"use client";

import { useEffect, useState, useTransition } from "react";
import { KeyRound } from "lucide-react";
import { browserSupportsWebAuthnAutofill, startAuthentication, WebAuthnAbortService } from "@simplewebauthn/browser";
import { useFormState } from "@/components/useFormState";

import { acceptInviteAction, enrollTwoFactor, finishEnrollment, passwordLogin, verifyTwoFactor } from "@/app/actions/auth";
import { passkeyLoginOptions, passkeyLoginVerify, passkeySecondFactorOptions, passkeySecondFactorVerify, type PasskeyState, type RequestOptionsResult } from "@/app/actions/passkeys";
import { passkeyErrorMessage, useWebAuthnSupported } from "./passkey-client";
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
          <input id="email" name="email" type="email" autoComplete="username webauthn" required={!ownerPassword} className={`${input} mb-3`} />
        </>
      )}
      <label className={label} htmlFor="password">Password</label>
      <input id="password" name="password" type="password" autoComplete="current-password" required className={input} />
      {state.error && <p className="mt-2 text-sm text-critical">{state.error}</p>}
      <button disabled={pending} className={button}>{pending ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}

export function TwoFactorForm({ autoFocus = true }: { autoFocus?: boolean }) {
  const [state, action, pending] = useFormState(verifyTwoFactor, {});
  return (
    <form onSubmit={action}>
      <label className={label} htmlFor="code">6-digit code or a recovery code</label>
      <input id="code" name="code" autoComplete="one-time-code" autoFocus={autoFocus} required maxLength={20} placeholder="000000" className={codeInput} />
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

/** Runs one passkey prompt: options from the server, the browser's prompt, then verification (which redirects on success). */
function usePasskeyCeremony(getOptions: () => Promise<RequestOptionsResult>, verify: (response: unknown) => Promise<PasskeyState>) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = () =>
    start(async () => {
      setError(null);
      const r = await getOptions();
      if (!r.options) return setError(r.error ?? "Passkeys are unavailable right now.");
      let response;
      try {
        response = await startAuthentication({ optionsJSON: r.options });
      } catch (err) {
        return setError(passkeyErrorMessage(err));
      }
      const v = await verify(response);
      if (v?.error) setError(v.error);
    });
  return { run, pending, error, setError };
}

const passkeyBtn = "hud-btn min-h-14 w-full gap-3 text-[13px] tracking-[0.18em] [--b:#3df5a0]";

/**
 * "Sign in with a passkey": no username, the passkey says who you are, and no
 * authenticator code afterwards. Hidden where the browser can't do passkeys.
 * With `autofill`, passkeys are also offered in the email field's suggestions.
 */
export function PasskeySignIn({ autofill = false }: { autofill?: boolean }) {
  const supported = useWebAuthnSupported();
  const { run, pending, error, setError } = usePasskeyCeremony(passkeyLoginOptions, passkeyLoginVerify);
  useEffect(() => {
    if (!supported || !autofill) return;
    let live = true;
    (async () => {
      if (!(await browserSupportsWebAuthnAutofill().catch(() => false)) || !live) return;
      const r = await passkeyLoginOptions().catch(() => null);
      if (!live || !r?.options) return;
      try {
        const response = await startAuthentication({ optionsJSON: r.options, useBrowserAutofill: true });
        const v = await passkeyLoginVerify(response);
        if (live && v?.error) setError(v.error);
      } catch {
        /* the button took over, or the person picked something else */
      }
    })();
    return () => {
      live = false;
      WebAuthnAbortService.cancelCeremony();
    };
  }, [supported, autofill, setError]);
  if (!supported) return null;
  return (
    <div>
      <button type="button" onClick={run} disabled={pending} className={passkeyBtn}>
        <KeyRound size={18} aria-hidden />
        {pending ? "Waiting for your passkey…" : "Sign in with a passkey"}
      </button>
      {error && <p role="alert" className="mt-2 text-sm text-critical">{error}</p>}
      <p className="mt-2 text-[13px] text-muted">Face ID, fingerprint or your device PIN. No authenticator code needed.</p>
    </div>
  );
}

/** On the 2FA step: a passkey of the same person instead of the authenticator code. */
export function PasskeySecondFactor() {
  const supported = useWebAuthnSupported();
  const { run, pending, error } = usePasskeyCeremony(passkeySecondFactorOptions, passkeySecondFactorVerify);
  if (!supported) return null;
  return (
    <div>
      <button type="button" onClick={run} disabled={pending} className={passkeyBtn}>
        <KeyRound size={18} aria-hidden />
        {pending ? "Waiting for your passkey…" : "Use a passkey instead of a code"}
      </button>
      {error && <p role="alert" className="mt-2 text-sm text-critical">{error}</p>}
    </div>
  );
}
