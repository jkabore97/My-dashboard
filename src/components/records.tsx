"use client";

import { useFormState } from "@/components/useFormState";
import { useEffect, useRef, useState, useTransition } from "react";
import { Check, RotateCcw, Trash2, X } from "lucide-react";
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

const input = "w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent";
const primary = "rounded-lg bg-accent px-3 py-2 text-sm font-medium text-bg hover:opacity-90 disabled:opacity-50";
const small = "inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs text-muted hover:border-accent/50 hover:text-ink disabled:opacity-50";

function Status({ state }: { state: RecordState }) {
  if (state.error) return <span className="text-sm text-critical">{state.error}</span>;
  if (state.ok) return <span className="text-sm text-ok">{state.ok}</span>;
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

function Toggle({ label, children }: { label: string; children: (close: () => void) => React.ReactNode }) {
  const [open, setOpen] = useState(false);
  if (!open) return <button type="button" onClick={() => setOpen(true)} className={primary}>{label}</button>;
  return <div className="rounded-xl border border-line bg-panel-2/40 p-4">{children(() => setOpen(false))}</div>;
}

function BusinessInput({ businesses, defaultValue }: { businesses: string[]; defaultValue?: string | null }) {
  return (
    <>
      <input name="business" list="record-businesses" placeholder="Business" defaultValue={defaultValue ?? ""} maxLength={80} className={input} />
      <datalist id="record-businesses">{businesses.map((b) => <option key={b} value={b} />)}</datalist>
    </>
  );
}

// ─── Invoices ────────────────────────────────────────────────────────────────

export function InvoiceForm({ businesses }: { businesses: string[] }) {
  const [state, action, pending] = useFormState(addInvoiceAction, {});
  const ref = useResetOnSave(state);
  return (
    <Toggle label="Add invoice">
      {(close) => (
        <form ref={ref} onSubmit={action} className="grid gap-2 sm:grid-cols-6">
          <input name="client" required maxLength={120} placeholder="Client" className={`${input} sm:col-span-3`} />
          <input name="number" maxLength={40} placeholder="Invoice # (optional)" className={`${input} sm:col-span-3`} />
          <input name="amount" required inputMode="decimal" placeholder="Amount, e.g. 1250.00" className={`${input} sm:col-span-2`} />
          <input name="currency" defaultValue="USD" maxLength={3} aria-label="Currency" className={`${input} uppercase sm:col-span-1`} />
          <div className="sm:col-span-3"><BusinessInput businesses={businesses} /></div>
          <label className="text-xs text-muted sm:col-span-3">Issued<input name="issuedOn" type="date" className={`${input} mt-1`} /></label>
          <label className="text-xs text-muted sm:col-span-3">Due<input name="dueOn" type="date" required className={`${input} mt-1`} /></label>
          <input name="notes" maxLength={500} placeholder="Notes (optional)" className={`${input} sm:col-span-6`} />
          <div className="flex items-center gap-3 sm:col-span-6">
            <button disabled={pending} className={primary}>{pending ? "Saving…" : "Save invoice"}</button>
            <button type="button" onClick={close} className="text-sm text-muted hover:text-ink">Close</button>
            <Status state={state} />
          </div>
        </form>
      )}
    </Toggle>
  );
}

export function InvoiceActions({ id, client }: { id: string; client: string }) {
  const [pending, start] = useTransition();
  return (
    <div className="flex shrink-0 gap-1">
      <button className={small} disabled={pending} onClick={() => start(() => markInvoiceAction(id, "paid"))}><Check size={12} />Paid</button>
      <button className={small} disabled={pending} title="Void" aria-label="Void" onClick={() => confirm(`Void the invoice for ${client}?`) && start(() => markInvoiceAction(id, "void"))}><X size={12} /></button>
      <button className={small} disabled={pending} title="Delete" aria-label="Delete" onClick={() => confirm(`Delete the invoice for ${client}?`) && start(() => deleteInvoiceAction(id))}><Trash2 size={12} /></button>
    </div>
  );
}

export function ReopenInvoice({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return <button className={small} disabled={pending} onClick={() => start(() => markInvoiceAction(id, "open"))}><RotateCcw size={12} />Reopen</button>;
}

export function ReopenDeadline({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return <button className={small} disabled={pending} onClick={() => start(() => reopenDeadlineAction(id))}><RotateCcw size={12} />Undo</button>;
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
      <input name="vendor" required maxLength={80} placeholder="Service, e.g. Vercel" defaultValue={s.vendor} className={`${input} sm:col-span-3`} />
      <input name="plan" maxLength={80} placeholder="Plan (optional)" defaultValue={s.plan ?? ""} className={`${input} sm:col-span-3`} />
      <input name="amount" required inputMode="decimal" placeholder="Price, e.g. 20.00" defaultValue={s.amount} className={`${input} sm:col-span-2`} />
      <input name="currency" defaultValue={s.currency ?? "USD"} maxLength={3} aria-label="Currency" className={`${input} uppercase sm:col-span-1`} />
      <select name="interval" defaultValue={s.interval ?? "month"} aria-label="Billing period" className={`${input} sm:col-span-1`}>
        <option value="month">Monthly</option>
        <option value="year">Yearly</option>
      </select>
      <div className="sm:col-span-2"><BusinessInput businesses={businesses} defaultValue={s.business} /></div>
      <label className="text-xs text-muted sm:col-span-3">Next renewal<input name="nextRenewal" type="date" defaultValue={s.nextRenewal ?? ""} className={`${input} mt-1`} /></label>
      <label className="flex items-center gap-2 self-end pb-2 text-sm sm:col-span-3"><input name="autoRenew" type="checkbox" defaultChecked={s.autoRenew ?? true} /> Renews automatically</label>
      <input name="url" type="url" placeholder="Billing page link (optional)" defaultValue={s.url ?? ""} className={`${input} sm:col-span-6`} />
      <input name="notes" maxLength={500} placeholder="Notes (optional)" defaultValue={s.notes ?? ""} className={`${input} sm:col-span-6`} />
    </>
  );
}

export function SubscriptionForm({ businesses }: { businesses: string[] }) {
  const [state, action, pending] = useFormState(saveSubscriptionAction, {});
  const ref = useResetOnSave(state);
  return (
    <Toggle label="Add subscription">
      {(close) => (
        <form ref={ref} onSubmit={action} className="grid gap-2 sm:grid-cols-6">
          <SubscriptionFields s={{}} businesses={businesses} />
          <div className="flex items-center gap-3 sm:col-span-6">
            <button disabled={pending} className={primary}>{pending ? "Saving…" : "Save"}</button>
            <button type="button" onClick={close} className="text-sm text-muted hover:text-ink">Close</button>
            <Status state={state} />
          </div>
        </form>
      )}
    </Toggle>
  );
}

export function SubscriptionRowActions({ s, businesses }: { s: SubscriptionDraft & { id: string; active: boolean }; businesses: string[] }) {
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [state, action, saving] = useFormState(saveSubscriptionAction, {});
  useEffect(() => {
    if (state.at && !state.error) setEditing(false);
  }, [state.at, state.error]);
  if (editing) {
    return (
      <form onSubmit={action} className="grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-6">
        <SubscriptionFields s={s} businesses={businesses} />
        <div className="flex items-center gap-3 sm:col-span-6">
          <button disabled={saving} className={primary}>Save</button>
          <button type="button" onClick={() => setEditing(false)} className="text-sm text-muted hover:text-ink">Cancel</button>
          <Status state={state} />
        </div>
      </form>
    );
  }
  return (
    <div className="flex shrink-0 gap-1">
      <button className={small} onClick={() => setEditing(true)}>Edit</button>
      <button className={small} disabled={pending} onClick={() => start(() => setSubscriptionActiveAction(s.id, !s.active))}>{s.active ? "Stop tracking" : "Reactivate"}</button>
      <button className={small} disabled={pending} title="Delete" aria-label="Delete" onClick={() => confirm(`Delete ${s.vendor}?`) && start(() => deleteSubscriptionAction(s.id))}><Trash2 size={12} /></button>
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
      <input name="title" required maxLength={160} placeholder="e.g. Q4 estimated tax payment" defaultValue={d.title} className={`${input} sm:col-span-6`} />
      <select name="category" defaultValue={d.category ?? "tax"} aria-label="Category" className={`${input} sm:col-span-2`}>
        <option value="tax">Tax</option>
        <option value="filing">Filing / registration</option>
        <option value="license">License / permit</option>
        <option value="insurance">Insurance</option>
        <option value="contract">Contract</option>
        <option value="other">Other</option>
      </select>
      <label className="text-xs text-muted sm:col-span-2">Due<input name="dueOn" type="date" required defaultValue={d.dueOn} className={`${input} mt-1`} /></label>
      <select name="recurrence" defaultValue={d.recurrence ?? "none"} aria-label="Repeats" className={`${input} self-end sm:col-span-2`}>
        <option value="none">Does not repeat</option>
        <option value="monthly">Every month</option>
        <option value="quarterly">Every quarter</option>
        <option value="yearly">Every year</option>
      </select>
      <label className="text-xs text-muted sm:col-span-2">Remind me (days before)<input name="remindDays" type="number" min={0} max={365} defaultValue={d.remindDays ?? 14} className={`${input} mt-1`} /></label>
      <div className="self-end sm:col-span-4"><BusinessInput businesses={businesses} defaultValue={d.business} /></div>
      <input name="url" type="url" placeholder="Link, e.g. the filing portal (optional)" defaultValue={d.url ?? ""} className={`${input} sm:col-span-6`} />
      <input name="notes" maxLength={500} placeholder="Notes (optional)" defaultValue={d.notes ?? ""} className={`${input} sm:col-span-6`} />
    </>
  );
}

export function DeadlineForm({ businesses }: { businesses: string[] }) {
  const [state, action, pending] = useFormState(saveDeadlineAction, {});
  const ref = useResetOnSave(state);
  return (
    <Toggle label="Add deadline">
      {(close) => (
        <form ref={ref} onSubmit={action} className="grid gap-2 sm:grid-cols-6">
          <DeadlineFields d={{}} businesses={businesses} />
          <div className="flex items-center gap-3 sm:col-span-6">
            <button disabled={pending} className={primary}>{pending ? "Saving…" : "Save"}</button>
            <button type="button" onClick={close} className="text-sm text-muted hover:text-ink">Close</button>
            <Status state={state} />
          </div>
        </form>
      )}
    </Toggle>
  );
}

export function DeadlineRowActions({ d, businesses, recurring }: { d: DeadlineDraft & { id: string; dueOn: string; title: string }; businesses: string[]; recurring: boolean }) {
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [state, action, saving] = useFormState(saveDeadlineAction, {});
  useEffect(() => {
    if (state.at && !state.error) setEditing(false);
  }, [state.at, state.error]);
  if (editing) {
    return (
      <form onSubmit={action} className="grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-6">
        <DeadlineFields d={d} businesses={businesses} />
        <div className="flex items-center gap-3 sm:col-span-6">
          <button disabled={saving} className={primary}>Save</button>
          <button type="button" onClick={() => setEditing(false)} className="text-sm text-muted hover:text-ink">Cancel</button>
          <Status state={state} />
        </div>
      </form>
    );
  }
  return (
    <div className="flex shrink-0 gap-1">
      <button className={small} disabled={pending} onClick={() => start(() => completeDeadlineAction(d.id, d.dueOn))} title={recurring ? "Done; moves to the next date" : "Done"}><Check size={12} />Done</button>
      <button className={small} onClick={() => setEditing(true)}>Edit</button>
      <button className={small} disabled={pending} title="Delete" aria-label="Delete" onClick={() => confirm(`Delete "${d.title}"${recurring ? " and all future occurrences" : ""}?`) && start(() => deleteDeadlineAction(d.id))}><Trash2 size={12} /></button>
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
        <textarea name="domains" rows={4} defaultValue={extra} placeholder={"kajconsulting.com\nkaj-mail.com"} className={`${input} mt-1 font-mono text-xs`} />
      </label>
      <label className="text-sm">
        <span className="text-muted">DKIM selectors to look for (comma-separated)</span>
        <input name="selectors" defaultValue={selectors} className={`${input} mt-1 font-mono text-xs`} />
      </label>
      <div className="flex items-center gap-3"><button disabled={pending} className={primary}>Save</button><Status state={state} /></div>
    </form>
  );
}

export function CheckNowButton() {
  const [state, action, pending] = useFormState(checkDomainsNowAction, {});
  return (
    <form onSubmit={action} className="flex items-center gap-3">
      <button disabled={pending} className={primary}>{pending ? "Checking…" : "Check now"}</button>
      <Status state={state} />
    </form>
  );
}

export function ChecklistToggle({ id, confirmed }: { id: string; confirmed: boolean }) {
  const [pending, start] = useTransition();
  return (
    <button className={small} disabled={pending} onClick={() => start(() => confirmChecklistAction(id, !confirmed))}>
      {confirmed ? <><RotateCcw size={12} />Undo</> : <><Check size={12} />It&apos;s on</>}
    </button>
  );
}
