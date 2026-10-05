"use client";

import { useState, useTransition, type CSSProperties } from "react";
import { KeyRound, Trash2 } from "lucide-react";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { passkeyReauthOptions, passkeyReauthVerify, passkeyReauthWithCode, passkeyRegisterOptions, passkeyRegisterVerify, removePasskeyAction } from "@/app/actions/passkeys";
import { passkeyErrorMessage, useWebAuthnSupported } from "@/components/passkey-client";
import { useFormState } from "@/components/useFormState";
import { btn, timeAgo } from "@/components/ui";

export interface PasskeyItem {
  id: string;
  name: string;
  synced: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

const solid = `${btn("solid")} min-h-10 gap-2 sm:min-h-0`;
const outline = `${btn()} min-h-10 gap-2 sm:min-h-0`;
const green = { "--b": "#3df5a0" } as CSSProperties;
const field = "hud-input min-h-10 px-3 py-1.5 text-sm";

function Msg({ error, ok }: { error?: string | null; ok?: string | null }) {
  if (error) return <p role="alert" className="text-xs text-critical">{error}</p>;
  if (ok) return <p className="text-xs text-emerald">✓ {ok}</p>;
  return null;
}

/** Confirm it's you (authenticator code, or an existing passkey) before adding a passkey. */
function Reauth({ hasPasskeys, onDone }: { hasPasskeys: boolean; onDone: () => void }) {
  const [state, action, pending] = useFormState(async (prev: Awaited<ReturnType<typeof passkeyReauthWithCode>>, form: FormData) => {
    const r = await passkeyReauthWithCode(prev, form);
    if (r.ok) onDone();
    return r;
  }, {});
  const [keyError, setKeyError] = useState<string | null>(null);
  const [keyPending, start] = useTransition();
  const withPasskey = () =>
    start(async () => {
      setKeyError(null);
      const r = await passkeyReauthOptions();
      if (!r.options) return setKeyError(r.error ?? "Try again.");
      try {
        const v = await passkeyReauthVerify(await startAuthentication({ optionsJSON: r.options }));
        if (v.error) return setKeyError(v.error);
        onDone();
      } catch (err) {
        setKeyError(passkeyErrorMessage(err));
      }
    });
  return (
    <div className="grid gap-2.5 border border-line/70 bg-bg/40 p-3">
      <p className="text-[13px] text-muted">For your security, confirm it&apos;s you first (you signed in more than 10 minutes ago).</p>
      <form onSubmit={action} className="flex flex-wrap items-center gap-2">
        <input name="code" inputMode="numeric" autoComplete="one-time-code" placeholder="123456" required maxLength={8} aria-label="Authenticator code" className={`${field} w-32 text-center font-mono tracking-[0.3em]`} />
        <button disabled={pending} className={outline}>{pending ? "Checking…" : "Confirm with code"}</button>
        {hasPasskeys && <button type="button" onClick={withPasskey} disabled={keyPending} className={outline} style={green}><KeyRound size={14} aria-hidden />{keyPending ? "Waiting…" : "Use a passkey"}</button>}
      </form>
      <Msg error={state.error ?? keyError} />
    </div>
  );
}

/** Settings → Security: add, list and remove your passkeys. */
export function PasskeyManager({ passkeys, fresh, available }: { passkeys: PasskeyItem[]; fresh: boolean; available: boolean }) {
  const supported = useWebAuthnSupported();
  const [needReauth, setNeedReauth] = useState(!fresh);
  const [name, setName] = useState("");
  const [msg, setMsg] = useState<{ error?: string | null; ok?: string | null }>({});
  const [pending, start] = useTransition();

  const add = () =>
    start(async () => {
      setMsg({});
      const r = await passkeyRegisterOptions();
      if (r.reauth) return setNeedReauth(true);
      if (!r.options) return setMsg({ error: r.error ?? "Try again." });
      let response;
      try {
        response = await startRegistration({ optionsJSON: r.options });
      } catch (err) {
        return setMsg({ error: passkeyErrorMessage(err) });
      }
      const v = await passkeyRegisterVerify(response, name);
      if (v.reauth) setNeedReauth(true);
      if (v.ok) setName("");
      setMsg({ error: v.error, ok: v.ok });
    });

  const remove = (p: PasskeyItem) => {
    const last = passkeys.length === 1;
    if (!confirm(`Remove the passkey “${p.name}”?${last ? " You'll sign in with your authenticator code again." : ""}`)) return;
    start(async () => {
      const r = await removePasskeyAction(p.id);
      setMsg({ error: r.error, ok: r.ok });
    });
  };

  return (
    <div className="grid gap-3">
      <p className="text-[13px] text-muted">
        Sign in with Face ID, your fingerprint or your device PIN, with <span className="text-ink">no authenticator code</span>. On iPhone and Mac it&apos;s saved to iCloud Keychain, on Android to Google Password Manager, on a Windows PC to Windows Hello. Your authenticator app and recovery codes keep working as a backup.
      </p>
      {passkeys.length > 0 && (
        <ul className="border border-line/70">
          {passkeys.map((p) => (
            <li key={p.id} className="flex items-center gap-3 border-b border-line/50 px-3 py-2.5 last:border-0">
              <span className="grid h-8 w-8 shrink-0 place-items-center border border-emerald/60 text-emerald shadow-[0_0_8px_rgb(61_245_160/0.25)]"><KeyRound size={15} aria-hidden /></span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">{p.name}</div>
                <div className="text-xs text-muted">{p.synced ? "Synced" : "This device only"} · added {timeAgo(p.createdAt)}{p.lastUsedAt ? ` · last used ${timeAgo(p.lastUsedAt)}` : " · not used yet"}</div>
              </div>
              <button type="button" onClick={() => remove(p)} disabled={pending} className={`${outline} px-3 text-[11px] [--b:#ff3d6e]`} aria-label={`Remove passkey ${p.name}`}>
                <Trash2 size={13} aria-hidden /><span className="hidden sm:inline">Remove</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {!available ? (
        <p className="text-[13px] text-muted">Passkeys only work on the dashboard&apos;s main address (APP_URL). Open it there to add one.</p>
      ) : !supported ? (
        <p className="text-[13px] text-muted">This browser can&apos;t create passkeys. Try Safari on iPhone, Chrome on Android, or Edge/Chrome on Windows.</p>
      ) : needReauth ? (
        <Reauth hasPasskeys={passkeys.length > 0} onDone={() => { setNeedReauth(false); setMsg({ ok: "Confirmed. Now add your passkey." }); }} />
      ) : (
        <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); add(); }}>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Name it, e.g. iPhone" aria-label="Passkey name" className={`${field} min-w-0 flex-1 sm:max-w-60`} />
          <button disabled={pending} className={solid} style={green}><KeyRound size={14} aria-hidden />{pending ? "Waiting for your device…" : "Add a passkey"}</button>
        </form>
      )}
      <Msg error={msg.error} ok={msg.ok} />
    </div>
  );
}
