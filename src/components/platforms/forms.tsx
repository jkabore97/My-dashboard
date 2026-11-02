"use client";

import { useFormState } from "@/components/useFormState";
import { useEffect, useRef, useTransition } from "react";
import { saveTokenConnection, disconnect, relabelConnection, saveGoogleCloudConnection } from "@/app/actions/connections";
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
      <p className="text-[13px] text-muted">{help} Stored encrypted.</p>
      <div className="flex items-center gap-3">
        <button disabled={pending} className={solid}>{pending ? "Checking…" : "Save token"}</button>
        {state.error && <span className="text-[13px] text-critical">{state.error}</span>}
        {state.ok && <span className="text-[13px] text-ok">{state.ok}</span>}
      </div>
    </form>
  );
}

export function DisconnectButton({ id, name }: { id: string; name: string }) {
  const [pending, start] = useTransition();
  return (
    <button disabled={pending} onClick={() => confirm(`Disconnect ${name}? Its stored credentials will be deleted.`) && start(() => disconnect(id))} className="hud-btn hud-btn-danger min-h-9 shrink-0 rounded-full px-3 py-1 text-[13px] sm:min-h-8">
      {pending ? "Removing…" : "Disconnect"}
    </button>
  );
}

export function RelabelForm({ id, label, business }: { id: string; label: string | null; business: string | null }) {
  const [pending, start] = useTransition();
  return (
    <form action={(f) => start(() => relabelConnection(id, f))} className="mt-2 flex flex-wrap gap-1.5">
      <input name="label" defaultValue={label ?? ""} placeholder="Label" aria-label="Label" className="hud-input min-h-10 w-28 min-w-0 flex-1 px-2.5 py-1 text-[15px] sm:min-h-8 sm:text-[13px]" />
      <input name="business" defaultValue={business ?? ""} placeholder="Business" aria-label="Business" className="hud-input min-h-10 w-28 min-w-0 flex-1 px-2.5 py-1 text-[15px] sm:min-h-8 sm:text-[13px]" />
      <button disabled={pending} className="hud-btn min-h-10 rounded-full px-3 py-1 text-[13px] sm:min-h-8">{pending ? "…" : "Save"}</button>
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
      {state.error && <p className="mt-1 text-[13px] text-critical">{state.error}</p>}
      {state.ok && <p className="mt-1 text-[13px] text-ok">{state.ok}</p>}
      {state.secret && <code className="mt-1.5 block break-all rounded-lg bg-fill px-2.5 py-2 font-mono text-[12.5px] text-ink">{state.secret}</code>}
    </div>
  );
}

/**
 * Google Cloud: paste the service-account JSON key (never shown again: the
 * field clears after saving) and, optionally, the billing-export table.
 */
export function GoogleCloudForm({ connected, exportTable }: { connected: boolean; exportTable: string | null }) {
  const [state, action, pending] = useFormState(saveGoogleCloudConnection, {});
  const key = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (state.ok && key.current) key.current.value = "";
  }, [state]);
  return (
    <form onSubmit={action} className="mt-3 grid gap-2">
      <textarea ref={key} name="key" rows={4} autoComplete="off" spellCheck={false} required={!connected} placeholder={connected ? "Service-account JSON key (leave empty to keep the saved one)" : "Paste the service-account JSON key ({ \"type\": \"service_account\", … })"} aria-label="Service-account JSON key" className={`${input} font-mono text-[12.5px] [-webkit-text-security:disc]`} />
      <input name="exportTable" defaultValue={exportTable ?? ""} autoComplete="off" placeholder="Billing export table (optional) — project.dataset.gcp_billing_export_v1_XXXXXX" aria-label="BigQuery billing export table" className={`${input} font-mono text-[12.5px]`} />
      <p className="text-[13px] text-muted">Read-only roles only: Billing Account Viewer, Browser, Firebase Viewer, BigQuery Data Viewer + Job User. The key is checked with Google, then stored encrypted and never shown again. Steps in docs/CONNECT.md.</p>
      <div className="flex flex-wrap items-center gap-3">
        <button disabled={pending} className={solid}>{pending ? "Checking…" : connected ? "Save" : "Connect Google Cloud"}</button>
        {state.error && <span role="alert" className="text-[13px] text-critical">{state.error}</span>}
        {state.ok && <span className="text-[13px] text-ok">{state.ok}</span>}
      </div>
    </form>
  );
}
