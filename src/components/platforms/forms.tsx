"use client";

import { useFormState } from "@/components/useFormState";
import { useTransition } from "react";
import { saveTokenConnection, disconnect, relabelConnection } from "@/app/actions/connections";
import { saveWebhookSecret } from "@/app/actions/settings";
import type { TokenField } from "@/lib/platforms";

import { btn, input as hudInput } from "@/components/ui";

const input = `${hudInput} min-h-10 sm:min-h-0`;
const button = `${btn()} min-h-10 sm:min-h-0`;
const solid = `${btn("solid")} min-h-10 sm:min-h-0`;

export function TokenForm({ provider, fields, help }: { provider: string; fields: TokenField[]; help: string }) {
  const [state, action, pending] = useFormState(saveTokenConnection, {});
  return (
    <form onSubmit={action} className="mt-3 grid gap-2">
      <input type="hidden" name="provider" value={provider} />
      {fields.map((f) => (
        <input key={f.name} name={f.name} type={f.secret ? "password" : "text"} autoComplete="off" required={!f.optional} placeholder={`${f.label}${f.optional ? " (optional)" : ""}${f.placeholder ? ` — ${f.placeholder}` : ""}`} className={input} />
      ))}
      <p className="text-xs text-muted">{help} Stored encrypted.</p>
      <div className="flex items-center gap-3">
        <button disabled={pending} className={solid}>{pending ? "Checking…" : "Save token"}</button>
        {state.error && <span className="text-xs text-critical">{state.error}</span>}
        {state.ok && <span className="text-xs text-ok">{state.ok}</span>}
      </div>
    </form>
  );
}

export function DisconnectButton({ id, name }: { id: string; name: string }) {
  const [pending, start] = useTransition();
  return (
    <button disabled={pending} onClick={() => confirm(`Disconnect ${name}? Its stored credentials will be deleted.`) && start(() => disconnect(id))} className="hud-btn min-h-10 shrink-0 px-2.5 py-1 text-[10.5px] text-muted [--b:#7f97ab] hover:text-critical sm:min-h-0">
      {pending ? "Removing…" : "Disconnect"}
    </button>
  );
}

export function RelabelForm({ id, label, business }: { id: string; label: string | null; business: string | null }) {
  const [pending, start] = useTransition();
  return (
    <form action={(f) => start(() => relabelConnection(id, f))} className="mt-1 flex flex-wrap gap-1">
      <input name="label" defaultValue={label ?? ""} placeholder="Label" aria-label="Label" className="hud-input min-h-10 w-28 min-w-0 flex-1 px-2 py-1 text-xs sm:min-h-0" />
      <input name="business" defaultValue={business ?? ""} placeholder="Business" aria-label="Business" className="hud-input min-h-10 w-28 min-w-0 flex-1 px-2 py-1 text-xs sm:min-h-0" />
      <button disabled={pending} className="hud-btn min-h-10 px-2.5 py-1 text-[10.5px] sm:min-h-0">{pending ? "…" : "Save"}</button>
    </form>
  );
}

export function WebhookSecretForm({ provider, canGenerate }: { provider: string; canGenerate: boolean }) {
  const [state, action, pending] = useFormState(saveWebhookSecret, {});
  return (
    <div className="mt-2">
      <form onSubmit={action} className="flex flex-wrap gap-2">
        <input type="hidden" name="provider" value={provider} />
        <input name="secret" type="password" autoComplete="off" placeholder={canGenerate ? "Paste or generate a secret" : "Paste signing secret"} aria-label="Webhook secret" className={`${input} min-w-0 flex-1 basis-48 font-mono`} />
        {canGenerate && <button name="generate" value="1" disabled={pending} className={solid} formNoValidate>Generate</button>}
        <button disabled={pending} className={button}>Save</button>
      </form>
      {state.error && <p className="mt-1 text-xs text-critical">{state.error}</p>}
      {state.ok && <p className="mt-1 text-xs text-ok">{state.ok}</p>}
      {state.secret && <code className="mt-1 block break-all bg-cyan/5 px-2 py-1 font-mono text-xs text-[#9be7ff]">{state.secret}</code>}
    </div>
  );
}
