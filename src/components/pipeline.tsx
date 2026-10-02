"use client";

import { useFormState } from "@/components/useFormState";
import { useEffect, useRef, useState, useTransition } from "react";
import { ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import { archiveClientAction, deleteDealAction, moveDealAction, saveClientAction, saveDealAction, savePlacesAction, type PipelineState } from "@/app/actions/pipeline";
import type { DealStage } from "@/lib/server/store/pipeline";
import { STAGE_LABEL } from "@/lib/pipeline-labels";

const input = "w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent";
const primary = "rounded-lg bg-accent px-3 py-2 text-sm font-medium text-bg hover:opacity-90 disabled:opacity-50";
const small = "inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs text-muted hover:border-accent/50 hover:text-ink disabled:opacity-50";

const OPEN: DealStage[] = ["lead", "proposal", "negotiation"];

function Status({ state }: { state: PipelineState }) {
  if (state.error) return <span className="text-sm text-critical">{state.error}</span>;
  if (state.ok) return <span className="text-sm text-ok">{state.ok}</span>;
  return null;
}

function useCloseOnSave(state: PipelineState, close: () => void, reset?: React.RefObject<HTMLFormElement | null>) {
  useEffect(() => {
    if (state.at && !state.error) {
      reset?.current?.reset();
      close();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.at, state.error]);
}

function BusinessField({ businesses, value }: { businesses: string[]; value?: string | null }) {
  return (
    <>
      <input name="business" list="pipeline-businesses" placeholder="Business" defaultValue={value ?? ""} maxLength={80} className={input} />
      <datalist id="pipeline-businesses">{businesses.map((b) => <option key={b} value={b} />)}</datalist>
    </>
  );
}

// ─── Clients ─────────────────────────────────────────────────────────────────

export interface ClientDraft {
  id?: string;
  name?: string;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  business?: string | null;
  notes?: string | null;
}

export function ClientForm({ client = {}, businesses, label = "Add client" }: { client?: ClientDraft; businesses: string[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useFormState(saveClientAction, {});
  const ref = useRef<HTMLFormElement>(null);
  useCloseOnSave(state, () => client.id && setOpen(false), client.id ? undefined : ref);
  if (!open) return <button type="button" className={client.id ? small : primary} onClick={() => setOpen(true)}>{label}</button>;
  return (
    <form ref={ref} onSubmit={action} className="grid gap-2 rounded-xl border border-line bg-panel-2/40 p-4 sm:grid-cols-6">
      {client.id && <input type="hidden" name="id" value={client.id} />}
      <input name="name" required maxLength={120} placeholder="Company or client name" defaultValue={client.name} className={`${input} sm:col-span-3`} />
      <input name="contactName" maxLength={120} placeholder="Contact person" defaultValue={client.contactName ?? ""} className={`${input} sm:col-span-3`} />
      <input name="email" type="email" maxLength={160} placeholder="Email" defaultValue={client.email ?? ""} className={`${input} sm:col-span-2`} />
      <input name="phone" maxLength={40} placeholder="Phone" defaultValue={client.phone ?? ""} className={`${input} sm:col-span-2`} />
      <div className="sm:col-span-2"><BusinessField businesses={businesses} value={client.business} /></div>
      <input name="website" type="url" maxLength={300} placeholder="Website (optional)" defaultValue={client.website ?? ""} className={`${input} sm:col-span-6`} />
      <textarea name="notes" maxLength={1000} rows={2} placeholder="Notes" defaultValue={client.notes ?? ""} className={`${input} sm:col-span-6`} />
      <div className="flex items-center gap-3 sm:col-span-6">
        <button disabled={pending} className={primary}>{pending ? "Saving…" : "Save client"}</button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-muted hover:text-ink">Close</button>
        <Status state={state} />
      </div>
    </form>
  );
}

export function ArchiveClient({ id, archived }: { id: string; archived: boolean }) {
  const [pending, start] = useTransition();
  return <button className={small} disabled={pending} onClick={() => start(() => archiveClientAction(id, !archived))}>{archived ? "Restore" : "Archive"}</button>;
}

// ─── Deals ───────────────────────────────────────────────────────────────────

export interface DealDraft {
  id?: string;
  clientId?: string | null;
  title?: string;
  value?: string;
  currency?: string;
  stage?: DealStage;
  expectedClose?: string | null;
  nextStep?: string | null;
  nextStepDue?: string | null;
  business?: string | null;
  notes?: string | null;
}

export function DealForm({ deal = {}, clients, businesses, label = "Add deal" }: { deal?: DealDraft; clients: { id: string; name: string }[]; businesses: string[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useFormState(saveDealAction, {});
  const ref = useRef<HTMLFormElement>(null);
  useCloseOnSave(state, () => setOpen(false), deal.id ? undefined : ref);
  if (!open) return <button type="button" className={deal.id ? small : primary} onClick={() => setOpen(true)}>{label}</button>;
  return (
    <form ref={ref} onSubmit={action} className="grid gap-2 rounded-xl border border-line bg-panel-2/40 p-4 text-left sm:grid-cols-6">
      {deal.id && <input type="hidden" name="id" value={deal.id} />}
      <input name="title" required maxLength={160} placeholder='Deal, e.g. "Website redesign"' defaultValue={deal.title} className={`${input} sm:col-span-4`} />
      <select name="clientId" defaultValue={deal.clientId ?? ""} aria-label="Client" className={`${input} sm:col-span-2`}>
        <option value="">No client yet</option>
        {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <select name="stage" defaultValue={deal.stage ?? "lead"} aria-label="Stage" className={`${input} sm:col-span-2`}>
        {(Object.keys(STAGE_LABEL) as DealStage[]).map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
      </select>
      <input name="value" inputMode="decimal" placeholder="Value (optional)" defaultValue={deal.value} className={`${input} sm:col-span-2`} />
      <input name="currency" defaultValue={deal.currency ?? "USD"} maxLength={3} aria-label="Currency" className={`${input} uppercase sm:col-span-1`} />
      <div className="sm:col-span-1"><BusinessField businesses={businesses} value={deal.business} /></div>
      <input name="nextStep" maxLength={200} placeholder="Next step, e.g. Send revised quote" defaultValue={deal.nextStep ?? ""} className={`${input} sm:col-span-4`} />
      <label className="text-xs text-muted sm:col-span-2">Next step due<input name="nextStepDue" type="date" defaultValue={deal.nextStepDue ?? ""} className={`${input} mt-1`} /></label>
      <label className="text-xs text-muted sm:col-span-2">Expected close<input name="expectedClose" type="date" defaultValue={deal.expectedClose ?? ""} className={`${input} mt-1`} /></label>
      <textarea name="notes" maxLength={1000} rows={2} placeholder="Notes" defaultValue={deal.notes ?? ""} className={`${input} self-end sm:col-span-4`} />
      <div className="flex items-center gap-3 sm:col-span-6">
        <button disabled={pending} className={primary}>{pending ? "Saving…" : "Save deal"}</button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-muted hover:text-ink">Close</button>
        <Status state={state} />
      </div>
    </form>
  );
}

export function DealMoves({ id, stage, title }: { id: string; stage: DealStage; title: string }) {
  const [pending, start] = useTransition();
  const i = OPEN.indexOf(stage);
  const move = (to: DealStage) => start(() => moveDealAction(id, to));
  if (i === -1) {
    return (
      <div className="flex gap-1">
        <button className={small} disabled={pending} onClick={() => move("negotiation")}>Reopen</button>
        <button className={small} disabled={pending} aria-label="Delete" title="Delete" onClick={() => confirm(`Delete "${title}"?`) && start(() => deleteDealAction(id))}><Trash2 size={12} /></button>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap gap-1">
      {i > 0 && <button className={small} disabled={pending} aria-label="Move back" title={`Back to ${STAGE_LABEL[OPEN[i - 1]]}`} onClick={() => move(OPEN[i - 1])}><ChevronLeft size={12} /></button>}
      {i < OPEN.length - 1 && <button className={small} disabled={pending} aria-label="Move forward" title={`On to ${STAGE_LABEL[OPEN[i + 1]]}`} onClick={() => move(OPEN[i + 1])}><ChevronRight size={12} /></button>}
      <button className={`${small} hover:border-ok/60 hover:text-ok`} disabled={pending} onClick={() => move("won")}>Won</button>
      <button className={small} disabled={pending} onClick={() => move("lost")}>Lost</button>
    </div>
  );
}

// ─── Settings: Google places ─────────────────────────────────────────────────

export function PlacesForm({ initial }: { initial: string }) {
  const [state, action, pending] = useFormState(savePlacesAction, {});
  return (
    <form onSubmit={action} className="grid gap-2">
      <textarea name="places" rows={4} defaultValue={initial} placeholder={"ChIJN1t_tDeuEmsRUsoyG83frY4 | Kaj Consulting"} className={`${input} font-mono text-xs`} />
      <div className="flex items-center gap-3"><button disabled={pending} className={primary}>Save</button><Status state={state} /></div>
    </form>
  );
}
