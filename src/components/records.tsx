"use client";

import { useFormState } from "@/components/useFormState";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { Check, Pencil, Plus, RotateCcw, Trash2, X } from "lucide-react";
import {
  addInvoiceAction,
  checkDomainsNowAction,
  completeDeadlineAction,
  confirmChecklistAction,
  deleteDeadlineAction,
  deleteInvoiceAction,
  deleteSubscriptionAction,
  markInvoiceAction,
  reopenDeadlineAction,
  saveDeadlineAction,
  saveDomainSettingsAction,
  saveSubscriptionAction,
  setSubscriptionActiveAction,
  type RecordState,
} from "@/app/actions/records";
import { act, actOk, field, fieldWrap, ghost, label as labelCls, primary } from "@/components/treasury/styles";

// Kept as they were for the Domains and Security pages, which own their look.
const legacyInput = "hud-input w-full px-3 py-2 text-sm placeholder:text-muted/70";
const legacyPrimary = "hud-btn hud-btn-solid";
const legacySmall = "hud-btn";

function Status({ state }: { state: RecordState }) {
  if (state.error) return <span role="alert" className="text-sm text-critical">{state.error}</span>;
  if (state.ok) return <span role="status" className="text-sm text-ok">{state.ok}</span>;
  return null;
}

/** A form that resets after a successful save. */
function useResetOnSave(state: RecordState) {
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.at && !state.error) ref.current?.reset();
  }, [state.at, state.error]);
  return ref;
}

/** A labelled field. */
function F({ label, className = "", children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <label className={`${fieldWrap} ${className}`}>
      <span className={labelCls}>{label}</span>
      {children}
    </label>
  );
}

/** An "Add …" button that opens its form as a full-width panel below. */
function Toggle({ label, children }: { label: string; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  if (!open) return <button type="button" onClick={() => setOpen(true)} className={primary}><Plus size={14} />{label}</button>;
  return <div className="hud-panel w-full basis-full p-4 sm:p-5">{children(() => setOpen(false))}</div>;
}

function FormFooter({ pending, saveLabel, onClose, closeLabel = "Close", state }: { pending: boolean; saveLabel: string; onClose?: () => void; closeLabel?: string; state: RecordState }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-3 col-span-full border-t border-line/70 pt-4">
      <span className="mr-auto"><Status state={state} /></span>
      {onClose && <button type="button" onClick={onClose} className={ghost}>{closeLabel}</button>}
      <button disabled={pending} className={primary}>{pending ? "Saving…" : saveLabel}</button>
    </div>
  );
}

function BusinessInput({ businesses, defaultValue }: { businesses: string[]; defaultValue?: string | null }) {
  return (
    <>
      <input name="business" list="record-businesses" placeholder="Business" defaultValue={defaultValue ?? ""} maxLength={80} className={field} />
      <datalist id="record-businesses">{businesses.map((b) => <option key={b} value={b} />)}</datalist>
    </>
  );
}

/** Radio buttons drawn as a segmented control. */
function Segmented({ name, options, defaultValue, label }: { name: string; options: [string, string][]; defaultValue: string; label: string }) {
  return (
    <fieldset className={fieldWrap}>
      <legend className={labelCls}>{label}</legend>
      <div className="flex border border-line">
        {options.map(([value, text]) => (
          <label key={value} className="hud-label flex min-h-10 flex-1 cursor-pointer items-center justify-center px-2 text-[11px] text-muted has-[:checked]:bg-[color-mix(in_srgb,var(--ga,#ffd84d)_12%,transparent)] has-[:checked]:text-[var(--ga,#ffd84d)] has-[:checked]:shadow-[inset_0_0_0_1px_var(--ga,#ffd84d)] has-[:focus-visible]:outline has-[:focus-visible]:outline-cyan">
            <input type="radio" name={name} value={value} defaultChecked={value === defaultValue} className="sr-only" />
            {text}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Check2({ name, defaultChecked, children }: { name: string; defaultChecked: boolean; children: ReactNode }) {
  return (
    <label className="flex min-h-10 cursor-pointer items-center gap-2.5 text-sm">
      <input name={name} type="checkbox" defaultChecked={defaultChecked} className="h-4 w-4 accent-[#3df5a0]" />
      {children}
    </label>
  );
}

// ─── Invoices ────────────────────────────────────────────────────────────────

export function InvoiceForm({ businesses }: { businesses: string[] }) {
  const [state, action, pending] = useFormState(addInvoiceAction, {});
  const ref = useResetOnSave(state);
  return (
    <Toggle label="Add invoice">
      {(close) => (
        <form ref={ref} onSubmit={action} className="grid gap-3 sm:grid-cols-6">
          <F label="Client" className="sm:col-span-3"><input name="client" required maxLength={120} placeholder="Who it's for" className={field} /></F>
          <F label="Invoice #" className="sm:col-span-3"><input name="number" maxLength={40} placeholder="Optional" className={field} /></F>
          <F label="Amount" className="sm:col-span-2"><input name="amount" required inputMode="decimal" placeholder="1250.00" className={`${field} font-mono`} /></F>
          <F label="Currency" className="sm:col-span-1"><input name="currency" defaultValue="USD" maxLength={3} className={`${field} font-mono uppercase`} /></F>
          <F label="Business" className="sm:col-span-3"><BusinessInput businesses={businesses} /></F>
          <F label="Issued" className="sm:col-span-3"><input name="issuedOn" type="date" className={`${field} font-mono`} /></F>
          <F label="Due" className="sm:col-span-3"><input name="dueOn" type="date" required className={`${field} font-mono`} /></F>
          <F label="Notes" className="sm:col-span-6"><input name="notes" maxLength={500} placeholder="Optional" className={field} /></F>
          <FormFooter pending={pending} saveLabel="Save invoice" onClose={close} state={state} />
        </form>
      )}
    </Toggle>
  );
}

export function InvoiceActions({ id, client }: { id: string; client: string }) {
  const [pending, start] = useTransition();
  return (
    <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
      <button className={actOk} disabled={pending} onClick={() => start(() => markInvoiceAction(id, "paid"))}><Check size={12} />Paid</button>
      <button className={act} disabled={pending} onClick={() => confirm(`Void the invoice for ${client}?`) && start(() => markInvoiceAction(id, "void"))}>Void</button>
      <button className={act} disabled={pending} title="Delete" aria-label={`Delete the invoice for ${client}`} onClick={() => confirm(`Delete the invoice for ${client}?`) && start(() => deleteInvoiceAction(id))}><X size={12} /></button>
    </div>
  );
}

export function ReopenInvoice({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return <button className={act} disabled={pending} onClick={() => start(() => markInvoiceAction(id, "open"))}><RotateCcw size={12} />Reopen</button>;
}

export function ReopenDeadline({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return <button className={act} disabled={pending} onClick={() => start(() => reopenDeadlineAction(id))}><RotateCcw size={12} />Undo</button>;
}

// ─── Subscriptions ───────────────────────────────────────────────────────────

export interface SubscriptionDraft {
  id?: string;
  vendor?: string;
  plan?: string | null;
  amount?: string;
  currency?: string;
  interval?: "month" | "year";
  nextRenewal?: string | null;
  autoRenew?: boolean;
  business?: string | null;
  url?: string | null;
  notes?: string | null;
}

function SubscriptionFields({ s, businesses }: { s: SubscriptionDraft; businesses: string[] }) {
  return (
    <>
      {s.id && <input type="hidden" name="id" value={s.id} />}
      <F label="Platform / vendor" className="col-span-2"><input name="vendor" required maxLength={80} placeholder="e.g. Vercel" defaultValue={s.vendor} className={field} /></F>
      <F label="Plan" className="col-span-2"><input name="plan" maxLength={80} placeholder="Optional, e.g. Pro · 3 seats" defaultValue={s.plan ?? ""} className={field} /></F>
      <F label="Price per period"><input name="amount" required inputMode="decimal" placeholder="20.00" defaultValue={s.amount} className={`${field} font-mono`} /></F>
      <F label="Currency"><input name="currency" defaultValue={s.currency ?? "USD"} maxLength={3} className={`${field} font-mono uppercase`} /></F>
      <div className="col-span-2"><Segmented name="interval" label="Billing cycle" defaultValue={s.interval ?? "month"} options={[["month", "Monthly"], ["year", "Yearly"]]} /></div>
      <F label="Next renewal"><input name="nextRenewal" type="date" defaultValue={s.nextRenewal ?? ""} className={`${field} font-mono`} /></F>
      <F label="Charged to"><BusinessInput businesses={businesses} defaultValue={s.business} /></F>
      <F label="Billing page URL" className="col-span-2"><input name="url" type="url" placeholder="Optional, https://…" defaultValue={s.url ?? ""} className={field} /></F>
      <F label="Notes" className="col-span-2 sm:col-span-4"><input name="notes" maxLength={500} placeholder="Optional" defaultValue={s.notes ?? ""} className={field} /></F>
      <div className="col-span-2 sm:col-span-4"><Check2 name="autoRenew" defaultChecked={s.autoRenew ?? true}>Renews automatically <span className="text-xs text-muted">(off: you get a warning before it ends)</span></Check2></div>
    </>
  );
}

const subGrid = "grid grid-cols-2 gap-3 sm:grid-cols-4";

/** "Add subscription": a button that opens the form, or the form itself when `inline`. */
export function SubscriptionForm({ businesses, inline = false, draft, label = "Add subscription" }: { businesses: string[]; inline?: boolean; /** Prefilled values (e.g. a bill detected in an e-mail). */ draft?: SubscriptionDraft; label?: string }) {
  const [state, action, pending] = useFormState(saveSubscriptionAction, {});
  const ref = useResetOnSave(state);
  const form = (close?: () => void) => (
    <form ref={ref} onSubmit={action} className={subGrid}>
      <SubscriptionFields s={draft ?? {}} businesses={businesses} />
      <FormFooter pending={pending} saveLabel="Save subscription" onClose={close} closeLabel="Cancel" state={state} />
    </form>
  );
  if (inline) return form(() => ref.current?.reset());
  return <Toggle label={label}>{(close) => form(close)}</Toggle>;
}

type SubRowData = SubscriptionDraft & { id: string; active: boolean; vendor: string };

function SubscriptionButtons({ s, onEdit, compact = false }: { s: SubRowData; onEdit: () => void; compact?: boolean }) {
  const [pending, start] = useTransition();
  return (
    <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
      <button className={act} onClick={onEdit} title="Edit" aria-label={`Edit ${s.vendor}`}>{compact ? <Pencil size={12} /> : "Edit"}</button>
      <button className={act} disabled={pending} title={s.active ? "Stop tracking (keeps the record, drops it from totals)" : "Track it again"} onClick={() => start(() => setSubscriptionActiveAction(s.id, !s.active))}>{s.active ? (compact ? "Stop" : "Stop tracking") : "Reactivate"}</button>
      <button className={act} disabled={pending} title="Delete" aria-label={`Delete ${s.vendor}`} onClick={() => confirm(`Delete ${s.vendor}?`) && start(() => deleteSubscriptionAction(s.id))}><Trash2 size={12} /></button>
    </div>
  );
}

function SubscriptionEdit({ s, businesses, onDone }: { s: SubRowData; businesses: string[]; onDone: () => void }) {
  const [state, action, saving] = useFormState(saveSubscriptionAction, {});
  useEffect(() => {
    if (state.at && !state.error) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.at, state.error]);
  return (
    <form onSubmit={action} className={`${subGrid} hud-cut mt-3 border border-line bg-panel-2/40 p-4`}>
      <SubscriptionFields s={s} businesses={businesses} />
      <FormFooter pending={saving} saveLabel="Save" onClose={onDone} closeLabel="Cancel" state={state} />
    </form>
  );
}

/** Edit / stop / delete buttons that turn into the edit form. */
export function SubscriptionRowActions({ s, businesses }: { s: SubRowData; businesses: string[] }) {
  const [editing, setEditing] = useState(false);
  if (editing) return <div className="w-full basis-full"><SubscriptionEdit s={s} businesses={businesses} onDone={() => setEditing(false)} /></div>;
  return <SubscriptionButtons s={s} onEdit={() => setEditing(true)} />;
}

/**
 * A subscription row: `children` are the row's cells (rendered on the server),
 * followed by the action buttons; editing opens the form across the full row.
 */
export function SubscriptionRow({ s, businesses, className, actionsClassName = "col-span-full flex justify-end sm:col-span-1", compact = false, children }: { s: SubRowData; businesses: string[]; className: string; actionsClassName?: string; compact?: boolean; children: ReactNode }) {
  const [editing, setEditing] = useState(false);
  return (
    <div className={className}>
      {children}
      <div className={actionsClassName}>{!editing && <SubscriptionButtons s={s} compact={compact} onEdit={() => setEditing(true)} />}</div>
      {editing && <div className="col-span-full"><SubscriptionEdit s={s} businesses={businesses} onDone={() => setEditing(false)} /></div>}
    </div>
  );
}

// ─── Deadlines ───────────────────────────────────────────────────────────────

export interface DeadlineDraft {
  id?: string;
  title?: string;
  category?: string;
  dueOn?: string;
  recurrence?: string;
  remindDays?: number;
  business?: string | null;
  url?: string | null;
  notes?: string | null;
}

function DeadlineFields({ d, businesses }: { d: DeadlineDraft; businesses: string[] }) {
  return (
    <>
      {d.id && <input type="hidden" name="id" value={d.id} />}
      <F label="What's due" className="sm:col-span-6"><input name="title" required maxLength={160} placeholder="e.g. Q4 estimated tax payment" defaultValue={d.title} className={field} /></F>
      <F label="Category" className="sm:col-span-2">
        <select name="category" defaultValue={d.category ?? "tax"} className={field}>
          <option value="tax">Tax</option>
          <option value="filing">Filing / registration</option>
          <option value="license">License / permit</option>
          <option value="insurance">Insurance</option>
          <option value="contract">Contract</option>
          <option value="other">Other</option>
        </select>
      </F>
      <F label="Due" className="sm:col-span-2"><input name="dueOn" type="date" required defaultValue={d.dueOn} className={`${field} font-mono`} /></F>
      <F label="Repeats" className="sm:col-span-2">
        <select name="recurrence" defaultValue={d.recurrence ?? "none"} className={field}>
          <option value="none">Does not repeat</option>
          <option value="monthly">Every month</option>
          <option value="quarterly">Every quarter</option>
          <option value="yearly">Every year</option>
        </select>
      </F>
      <F label="Remind me (days before)" className="sm:col-span-2"><input name="remindDays" type="number" min={0} max={365} defaultValue={d.remindDays ?? 14} className={`${field} font-mono`} /></F>
      <F label="Business" className="sm:col-span-4"><BusinessInput businesses={businesses} defaultValue={d.business} /></F>
      <F label="Link" className="sm:col-span-6"><input name="url" type="url" placeholder="Optional, e.g. the filing portal" defaultValue={d.url ?? ""} className={field} /></F>
      <F label="Notes" className="sm:col-span-6"><input name="notes" maxLength={500} placeholder="Optional" defaultValue={d.notes ?? ""} className={field} /></F>
    </>
  );
}

export function DeadlineForm({ businesses }: { businesses: string[] }) {
  const [state, action, pending] = useFormState(saveDeadlineAction, {});
  const ref = useResetOnSave(state);
  return (
    <Toggle label="Add deadline">
      {(close) => (
        <form ref={ref} onSubmit={action} className="grid gap-3 sm:grid-cols-6">
          <DeadlineFields d={{}} businesses={businesses} />
          <FormFooter pending={pending} saveLabel="Save deadline" onClose={close} state={state} />
        </form>
      )}
    </Toggle>
  );
}

type DeadlineRowData = DeadlineDraft & { id: string; dueOn: string; title: string };

function DeadlineButtons({ d, recurring, onEdit }: { d: DeadlineRowData; recurring: boolean; onEdit: () => void }) {
  const [pending, start] = useTransition();
  return (
    <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
      <button className={actOk} disabled={pending} onClick={() => start(() => completeDeadlineAction(d.id, d.dueOn))} title={recurring ? "Done; moves to the next date" : "Done"}><Check size={12} />Done</button>
      <button className={act} onClick={onEdit}>Edit</button>
      <button className={act} disabled={pending} title="Delete" aria-label={`Delete ${d.title}`} onClick={() => confirm(`Delete "${d.title}"${recurring ? " and all future occurrences" : ""}?`) && start(() => deleteDeadlineAction(d.id))}><X size={12} /></button>
    </div>
  );
}

function DeadlineEdit({ d, businesses, onDone }: { d: DeadlineRowData; businesses: string[]; onDone: () => void }) {
  const [state, action, saving] = useFormState(saveDeadlineAction, {});
  useEffect(() => {
    if (state.at && !state.error) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.at, state.error]);
  return (
    <form onSubmit={action} className="hud-cut mt-3 grid gap-3 border border-line bg-panel-2/40 p-4 sm:grid-cols-6">
      <DeadlineFields d={d} businesses={businesses} />
      <FormFooter pending={saving} saveLabel="Save" onClose={onDone} closeLabel="Cancel" state={state} />
    </form>
  );
}

export function DeadlineRowActions({ d, businesses, recurring }: { d: DeadlineRowData; businesses: string[]; recurring: boolean }) {
  const [editing, setEditing] = useState(false);
  if (editing) return <div className="w-full basis-full"><DeadlineEdit d={d} businesses={businesses} onDone={() => setEditing(false)} /></div>;
  return <DeadlineButtons d={d} recurring={recurring} onEdit={() => setEditing(true)} />;
}

/** A deadline row: server-rendered cells, then actions; editing opens the form across the row. */
export function DeadlineRow({ d, businesses, recurring, className, children }: { d: DeadlineRowData; businesses: string[]; recurring: boolean; className: string; children: ReactNode }) {
  const [editing, setEditing] = useState(false);
  return (
    <div className={className}>
      {children}
      <div className="col-start-2 flex sm:col-start-auto sm:justify-end">{!editing && <DeadlineButtons d={d} recurring={recurring} onEdit={() => setEditing(true)} />}</div>
      {editing && <div className="col-span-full"><DeadlineEdit d={d} businesses={businesses} onDone={() => setEditing(false)} /></div>}
    </div>
  );
}

// ─── Domains ─────────────────────────────────────────────────────────────────

export function DomainSettingsForm({ extra, selectors }: { extra: string; selectors: string }) {
  const [state, action, pending] = useFormState(saveDomainSettingsAction, {});
  return (
    <form onSubmit={action} className="grid gap-3">
      <label className="text-sm">
        <span className="text-muted">Extra domains to watch (your websites are included automatically), one per line</span>
        <textarea name="domains" rows={4} defaultValue={extra} placeholder={"kajconsulting.com\nkaj-mail.com"} className={`${legacyInput} mt-1 font-mono text-xs`} />
      </label>
      <label className="text-sm">
        <span className="text-muted">DKIM selectors to look for (comma-separated)</span>
        <input name="selectors" defaultValue={selectors} className={`${legacyInput} mt-1 font-mono text-xs`} />
      </label>
      <div className="flex items-center gap-3"><button disabled={pending} className={legacyPrimary}>Save</button><Status state={state} /></div>
    </form>
  );
}

export function CheckNowButton() {
  const [state, action, pending] = useFormState(checkDomainsNowAction, {});
  return (
    <form onSubmit={action} className="flex items-center gap-3">
      <button disabled={pending} className={legacyPrimary}>{pending ? "Checking…" : "Check now"}</button>
      <Status state={state} />
    </form>
  );
}

export function ChecklistToggle({ id, confirmed }: { id: string; confirmed: boolean }) {
  const [pending, start] = useTransition();
  return (
    <button className={legacySmall} disabled={pending} onClick={() => start(() => confirmChecklistAction(id, !confirmed))}>
      {confirmed ? <><RotateCcw size={12} />Undo</> : <><Check size={12} />It&apos;s on</>}
    </button>
  );
}
