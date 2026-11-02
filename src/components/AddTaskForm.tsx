"use client";

import { useFormState } from "@/components/useFormState";
import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { addTaskAction } from "@/app/actions/tasks";

const field = "hud-input min-h-11 w-full px-3 py-2 text-[15px] placeholder:text-muted/70";

/**
 * "+ Add task" button that opens the New task sheet. Closed, it's a button;
 * open, it's a full-width panel (`order-2 basis-full`), so a flex-wrap header
 * can place it under the page title and the numbers.
 */
export function AddTaskForm({ businesses, defaultBusiness, people = [] }: { businesses: string[]; defaultBusiness?: string; people?: { email: string; name: string }[] }) {
  const [state, action, pending] = useFormState(addTaskAction, {});
  const [open, setOpen] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) form.current?.reset();
  }, [state.ok]);

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="hud-btn hud-btn-solid min-h-10 rounded-full px-4">
        <Plus size={16} strokeWidth={2.5} /> Add task
      </button>
    );
  }
  return (
    <section className="hud-panel order-2 basis-full overflow-hidden">
      <form ref={form} onSubmit={action}>
        <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5 sm:px-5">
          <button type="button" onClick={() => setOpen(false)} className="min-h-10 text-[15px] text-cyan hover:opacity-70">Close</button>
          <h2 className="text-[17px] font-semibold text-ink">New task</h2>
          <button disabled={pending} className="min-h-10 text-[15px] font-semibold text-cyan hover:opacity-70 disabled:opacity-40">{pending ? "Adding…" : "Add"}</button>
        </header>
        <div className="grid grid-cols-2 gap-2.5 p-4 sm:grid-cols-6 sm:p-5">
          <input name="title" required maxLength={200} placeholder="What needs doing?" className={`${field} col-span-2 text-[17px] sm:col-span-6`} autoFocus />
          <input name="detail" placeholder="Notes (optional)" maxLength={500} className={`${field} col-span-2 sm:col-span-6`} />
          <select name="severity" defaultValue="medium" className={`${field} sm:col-span-1`} aria-label="Severity">
            <option value="critical">◆ Critical</option>
            <option value="high">▲ High</option>
            <option value="medium">● Medium</option>
            <option value="low">○ Low</option>
          </select>
          <input name="business" list="add-biz" defaultValue={defaultBusiness} placeholder="Business" maxLength={80} className={`${field} sm:col-span-2`} />
          <datalist id="add-biz">{businesses.map((b) => <option key={b} value={b} />)}</datalist>
          <input name="url" type="url" placeholder="Link (optional)" className={`${field} ${people.length ? "sm:col-span-2" : "col-span-2 sm:col-span-3"}`} />
          {people.length > 0 && (
            <select name="assignee" defaultValue="" className={`${field} sm:col-span-1`} aria-label="Assign to">
              <option value="">Unassigned</option>
              {people.map((p) => <option key={p.email} value={p.email}>{p.name}</option>)}
            </select>
          )}
          <div className="col-span-2 flex flex-wrap items-center gap-2.5 sm:col-span-6">
            <button disabled={pending} className="hud-btn hud-btn-solid min-h-10 px-5">{pending ? "Adding…" : "Add task"}</button>
            {state.error && <span className="text-[13px] text-critical">{state.error}</span>}
            {state.ok && !state.error && <span className="text-[13px] text-ok">Added ✓</span>}
            {!state.error && !state.ok && <span className="text-[13px] text-muted">Manual task{people.length ? ". The person you assign sees it under “Assigned to me”." : "."}</span>}
          </div>
        </div>
      </form>
    </section>
  );
}
