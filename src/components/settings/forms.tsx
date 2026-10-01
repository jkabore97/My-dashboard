"use client";

import { useActionState } from "react";
import { saveBusinessRules, saveWebsites } from "@/app/actions/settings";
import { regenerateRecoveryCodes, resetTwoFactor } from "@/app/actions/auth";
import { RecoveryCodes } from "@/components/RecoveryCodes";

const area = "w-full rounded-lg border border-line bg-bg px-3 py-2 font-mono text-xs outline-none focus:border-accent";
const button = "rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-bg hover:opacity-90 disabled:opacity-50";
const codeInput = "w-40 rounded-lg border border-line bg-bg px-3 py-1.5 text-sm tracking-widest outline-none focus:border-accent";

function Status({ state }: { state: { error?: string; ok?: string } }) {
  if (state.error) return <p className="text-xs text-critical">{state.error}</p>;
  if (state.ok) return <p className="whitespace-pre-line text-xs text-ok">{state.ok.split("\n")[0]}</p>;
  return null;
}

export function BusinessRulesForm({ initial }: { initial: string }) {
  const [state, action, pending] = useActionState(saveBusinessRules, {});
  return (
    <form action={action} className="grid gap-2">
      <textarea name="rules" rows={6} defaultValue={initial} placeholder={"kaj = Kaj Consulting\nshop = Kaj Store"} className={area} />
      <div className="flex items-center gap-3"><button disabled={pending} className={button}>Save</button><Status state={state} /></div>
    </form>
  );
}

export function WebsitesForm({ initial }: { initial: string }) {
  const [state, action, pending] = useActionState(saveWebsites, {});
  return (
    <form action={action} className="grid gap-2">
      <textarea name="sites" rows={6} defaultValue={initial} placeholder={"kajconsulting.com | Kaj Consulting | abcdefghijklmnopqrst\nshop.example | Kaj Store"} className={area} />
      <div className="flex items-center gap-3"><button disabled={pending} className={button}>Save</button><Status state={state} /></div>
    </form>
  );
}

export function RegenerateCodesForm() {
  const [state, action, pending] = useActionState(regenerateRecoveryCodes, {});
  if (state.codes) return <RecoveryCodes codes={state.codes} />;
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input name="code" inputMode="numeric" autoComplete="one-time-code" placeholder="123456" required className={codeInput} />
      <button disabled={pending} className={button}>New recovery codes</button>
      {state.error && <span className="text-xs text-critical">{state.error}</span>}
    </form>
  );
}

export function ResetTwoFactorForm() {
  const [state, action, pending] = useActionState(resetTwoFactor, {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-2" onSubmit={(e) => { if (!confirm("Remove 2FA and sign out of every device?")) e.preventDefault(); }}>
      <input name="code" autoComplete="one-time-code" placeholder="Code or recovery code" required className={`${codeInput} w-52 tracking-normal`} />
      <button disabled={pending} className="rounded-lg border border-critical/50 px-3 py-1.5 text-sm text-critical hover:bg-critical/10 disabled:opacity-50">Reset 2FA</button>
      {state.error && <span className="text-xs text-critical">{state.error}</span>}
    </form>
  );
}
