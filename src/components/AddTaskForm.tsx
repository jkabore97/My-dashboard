"use client";

import { useFormState } from "@/components/useFormState";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Plus } from "lucide-react";
import { addTaskAction } from "@/app/actions/tasks";

const field = "hud-input min-h-11 w-full px-3 py-2 text-sm placeholder:text-muted/70";

/**
 * "+ Add task" button that opens the New task panel. Closed, it's a button;
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
      <button onClick={() => setOpen(true)} className="hud-btn hud-btn-solid min-h-10">
        <Plus size={14} /> Add task
      </button>
    );
  }
  return (
    <section className="hud-panel order-2 basis-full" style={{ "--a": "#a98bff" } as CSSProperties}>
      <header className="hud-head flex flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-5">
        <h2 className="hud-title text-[13px]">New task</h2>
        <span className="hud-label hidden text-[11px] tracking-[0.12em] text-muted sm:inline">Manual{people.length ? " · assign to anyone on the team" : ""}</span>
      </header>
      <form ref={form} onSubmit={action} className="grid grid-cols-2 gap-2.5 p-4 sm:grid-cols-6 sm:p-5">
        <input name="title" required maxLength={200} placeholder="What needs doing?" className={`${field} col-span-2 sm:col-span-6`} autoFocus />
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
        <input name="detail" placeholder="Notes (optional)" maxLength={500} className={`${field} col-span-2 sm:col-span-6`} />
        <div className="col-span-2 flex flex-wrap items-center gap-2.5 sm:col-span-6">
          <button disabled={pending} className="hud-btn hud-btn-solid min-h-10">{pending ? "Adding…" : "Add task"}</button>
          <button type="button" onClick={() => setOpen(false)} className="hud-btn min-h-10" style={{ "--b": "#ff5fd7" } as CSSProperties}>Close</button>
          {state.error && <span className="text-sm text-critical">{state.error}</span>}
          {state.ok && !state.error && <span className="text-sm text-ok">Added.</span>}
          {!state.error && !state.ok && people.length > 0 && <span className="hidden text-[12.5px] text-muted sm:inline">The person you assign sees it under “Assigned to me”.</span>}
        </div>
      </form>
    </section>
  );
}
