"use client";

import { useFormState } from "@/components/useFormState";
import { useEffect, useRef, useState, useTransition } from "react";
import { ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import { act, actOk, field, fieldWrap, ghost, label as labelCls, primary } from "@/components/treasury/styles";
import { archiveClientAction, deleteDealAction, moveDealAction, saveClientAction, saveDealAction, savePlacesAction, type PipelineState } from "@/app/actions/pipeline";
import type { DealStage } from "@/lib/server/store/pipeline";
import { STAGE_LABEL } from "@/lib/pipeline-labels";

// Kept as it was for the Settings page (PlacesForm), which owns its look.
const input = "w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent";
const legacyPrimary = "hud-btn hud-btn-solid";

const OPEN: DealStage[] = ["lead", "proposal", "negotiation"];

function Status({ state }: { state: PipelineState }) {
  if (state.error) return <span role="alert" className="text-sm text-critical">{state.error}</span>;
  if (state.ok) return <span role="status" className="text-sm text-ok">{state.ok}</span>;
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

function F({ label, className = "", children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={`${fieldWrap} ${className}`}>
      <span className={labelCls}>{label}</span>
      {children}
    </label>
  );
}

function Footer({ pending, save, onClose, state }: { pending: boolean; save: string; onClose: () => void; state: PipelineState }) {
  return (
    <div className="col-span-full flex flex-wrap items-center justify-end gap-3 border-t border-line/70 pt-4">
      <span className="mr-auto"><Status state={state} /></span>
      <button type="button" onClick={onClose} className={ghost}>Close</button>
      <button disabled={pending} className={primary}>{pending ? "Saving…" : save}</button>
    </div>
  );
}

function BusinessField({ businesses, value }: { businesses: string[]; value?: string | null }) {
  return (
    <>
      <input name="business" list="pipeline-businesses" placeholder="Business" defaultValue={value ?? ""} maxLength={80} className={field} />
      <datalist id="pipeline-businesses">{businesses.map((b) => <option key={b} value={b} />)}</datalist>
    </>
  );
}

const panel = "hud-panel w-full basis-full p-4 text-left sm:p-5";

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
  if (!open) return <button type="button" className={client.id ? act : primary} onClick={() => setOpen(true)}>{client.id ? label : <><Plus size={14} />{label}</>}</button>;
  return (
    <div className="@container w-full basis-full"><form ref={ref} onSubmit={action} className={`${panel} grid gap-3 @lg:grid-cols-6`}>
      {client.id && <input type="hidden" name="id" value={client.id} />}
      <F label="Company or client" className="@lg:col-span-3"><input name="name" required maxLength={120} placeholder="Name" defaultValue={client.name} className={field} /></F>
      <F label="Contact person" className="@lg:col-span-3"><input name="contactName" maxLength={120} placeholder="Optional" defaultValue={client.contactName ?? ""} className={field} /></F>
      <F label="Email" className="@lg:col-span-2"><input name="email" type="email" maxLength={160} placeholder="Optional" defaultValue={client.email ?? ""} className={field} /></F>
      <F label="Phone" className="@lg:col-span-2"><input name="phone" maxLength={40} placeholder="Optional" defaultValue={client.phone ?? ""} className={field} /></F>
      <F label="Business" className="@lg:col-span-2"><BusinessField businesses={businesses} value={client.business} /></F>
      <F label="Website" className="@lg:col-span-6"><input name="website" type="url" maxLength={300} placeholder="Optional, https://…" defaultValue={client.website ?? ""} className={field} /></F>
      <F label="Notes" className="@lg:col-span-6"><textarea name="notes" maxLength={1000} rows={2} placeholder="Optional" defaultValue={client.notes ?? ""} className={field} /></F>
      <Footer pending={pending} save="Save client" onClose={() => setOpen(false)} state={state} />
    </form></div>
  );
}

export function ArchiveClient({ id, archived }: { id: string; archived: boolean }) {
  const [pending, start] = useTransition();
  return <button className={act} disabled={pending} onClick={() => start(() => archiveClientAction(id, !archived))}>{archived ? "Restore" : "Archive"}</button>;
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
  if (!open) return <button type="button" className={deal.id ? act : primary} onClick={() => setOpen(true)}>{deal.id ? label : <><Plus size={14} />{label}</>}</button>;
  return (
    <div className="@container w-full basis-full"><form ref={ref} onSubmit={action} className={`${panel} grid gap-3 @lg:grid-cols-6`}>
      {deal.id && <input type="hidden" name="id" value={deal.id} />}
      <F label="Deal" className="@lg:col-span-4"><input name="title" required maxLength={160} placeholder='e.g. "Website redesign"' defaultValue={deal.title} className={field} /></F>
      <F label="Client" className="@lg:col-span-2">
        <select name="clientId" defaultValue={deal.clientId ?? ""} className={field}>
          <option value="">No client yet</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </F>
      <F label="Stage" className="@lg:col-span-2">
        <select name="stage" defaultValue={deal.stage ?? "lead"} className={field}>
          {(Object.keys(STAGE_LABEL) as DealStage[]).map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
        </select>
      </F>
      <F label="Value" className="@lg:col-span-2"><input name="value" inputMode="decimal" placeholder="Optional" defaultValue={deal.value} className={`${field} font-mono`} /></F>
      <F label="Currency" className="@lg:col-span-1"><input name="currency" defaultValue={deal.currency ?? "USD"} maxLength={3} className={`${field} font-mono uppercase`} /></F>
      <F label="Business" className="@lg:col-span-1"><BusinessField businesses={businesses} value={deal.business} /></F>
      <F label="Next step" className="@lg:col-span-4"><input name="nextStep" maxLength={200} placeholder="e.g. Send revised quote" defaultValue={deal.nextStep ?? ""} className={field} /></F>
      <F label="Next step due" className="@lg:col-span-2"><input name="nextStepDue" type="date" defaultValue={deal.nextStepDue ?? ""} className={`${field} font-mono`} /></F>
      <F label="Expected close" className="@lg:col-span-2"><input name="expectedClose" type="date" defaultValue={deal.expectedClose ?? ""} className={`${field} font-mono`} /></F>
      <F label="Notes" className="@lg:col-span-4"><textarea name="notes" maxLength={1000} rows={2} placeholder="Optional" defaultValue={deal.notes ?? ""} className={field} /></F>
      <Footer pending={pending} save="Save deal" onClose={() => setOpen(false)} state={state} />
    </form></div>
  );
}

export function DealMoves({ id, stage, title }: { id: string; stage: DealStage; title: string }) {
  const [pending, start] = useTransition();
  const i = OPEN.indexOf(stage);
  const move = (to: DealStage) => start(() => moveDealAction(id, to));
  if (i === -1) {
    return (
      <div className="flex gap-1.5">
        <button className={act} disabled={pending} onClick={() => move("negotiation")}>Reopen</button>
        <button className={act} disabled={pending} aria-label={`Delete ${title}`} title="Delete" onClick={() => confirm(`Delete "${title}"?`) && start(() => deleteDealAction(id))}><Trash2 size={12} /></button>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {i > 0 && <button className={`${act} [--b:#7f97ab]`} disabled={pending} aria-label={`Back to ${STAGE_LABEL[OPEN[i - 1]]}`} title={`Back to ${STAGE_LABEL[OPEN[i - 1]]}`} onClick={() => move(OPEN[i - 1])}><ChevronLeft size={12} /></button>}
      {i < OPEN.length - 1 && <button className={`${act} [--b:#7f97ab]`} disabled={pending} aria-label={`On to ${STAGE_LABEL[OPEN[i + 1]]}`} title={`On to ${STAGE_LABEL[OPEN[i + 1]]}`} onClick={() => move(OPEN[i + 1])}><ChevronRight size={12} /></button>}
      <button className={actOk} disabled={pending} onClick={() => move("won")}>Won</button>
      <button className={act} disabled={pending} onClick={() => move("lost")}>Lost</button>
    </div>
  );
}

// ─── Settings: Google places ─────────────────────────────────────────────────

export function PlacesForm({ initial }: { initial: string }) {
  const [state, action, pending] = useFormState(savePlacesAction, {});
  return (
    <form onSubmit={action} className="grid gap-2">
      <textarea name="places" rows={4} defaultValue={initial} placeholder={"ChIJN1t_tDeuEmsRUsoyG83frY4 | Kaj Consulting"} className={`${input} font-mono text-xs`} />
      <div className="flex items-center gap-3"><button disabled={pending} className={legacyPrimary}>Save</button><Status state={state} /></div>
    </form>
  );
}
