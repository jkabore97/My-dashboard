"use client";

import { useFormState } from "@/components/useFormState";
import { useTransition } from "react";
import { saveTokenConnection, disconnect, relabelConnection } from "@/app/actions/connections";
import { saveWebhookSecret } from "@/app/actions/settings";
import type { TokenField } from "@/lib/platforms";

const input = "w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent";
const button = "rounded-lg border border-line px-3 py-1.5 text-xs hover:border-accent/50 disabled:opacity-50";

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
        <button disabled={pending} className={button}>{pending ? "Checking…" : "Save token"}</button>
        {state.error && <span className="text-xs text-critical">{state.error}</span>}
        {state.ok && <span className="text-xs text-ok">{state.ok}</span>}
      </div>
    </form>
  );
}

export function DisconnectButton({ id, name }: { id: string; name: string }) {
  const [pending, start] = useTransition();
  return (
    <button disabled={pending} onClick={() => confirm(`Disconnect ${name}? Its stored credentials will be deleted.`) && start(() => disconnect(id))} className="text-xs text-muted hover:text-critical disabled:opacity-50">
      {pending ? "Removing…" : "Disconnect"}
    </button>
  );
}

export function RelabelForm({ id, label, business }: { id: string; label: string | null; business: string | null }) {
  const [pending, start] = useTransition();
  return (
    <form action={(f) => start(() => relabelConnection(id, f))} className="mt-1 flex flex-wrap gap-1">
      <input name="label" defaultValue={label ?? ""} placeholder="Label" className="w-32 rounded border border-line bg-bg px-2 py-1 text-xs outline-none focus:border-accent" />
      <input name="business" defaultValue={business ?? ""} placeholder="Business" className="w-32 rounded border border-line bg-bg px-2 py-1 text-xs outline-none focus:border-accent" />
      <button disabled={pending} className="rounded border border-line px-2 py-1 text-xs hover:border-accent/50 disabled:opacity-50">{pending ? "…" : "Save"}</button>
    </form>
  );
}

export function WebhookSecretForm({ provider, canGenerate }: { provider: string; canGenerate: boolean }) {
  const [state, action, pending] = useFormState(saveWebhookSecret, {});
  return (
    <div className="mt-2">
      <form onSubmit={action} className="flex flex-wrap gap-2">
        <input type="hidden" name="provider" value={provider} />
        <input name="secret" type="password" autoComplete="off" placeholder="Paste signing secret" className={`${input} min-w-0 flex-1 basis-48`} />
        <button disabled={pending} className={button}>Save</button>
        {canGenerate && <button name="generate" value="1" disabled={pending} className={button} formNoValidate>Generate</button>}
      </form>
      {state.error && <p className="mt-1 text-xs text-critical">{state.error}</p>}
      {state.ok && <p className="mt-1 text-xs text-ok">{state.ok}</p>}
      {state.secret && <code className="mt-1 block break-all rounded bg-bg px-2 py-1 text-xs">{state.secret}</code>}
    </div>
  );
}
