"use client";

import { useFormState } from "@/components/useFormState";
import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { addTaskAction } from "@/app/actions/tasks";

const input = "rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent";

export function AddTaskForm({ businesses, defaultBusiness }: { businesses: string[]; defaultBusiness?: string }) {
  const [state, action, pending] = useFormState(addTaskAction, {});
  const [open, setOpen] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) form.current?.reset();
  }, [state.ok]);

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-bg hover:opacity-90">
        <Plus size={14} /> Add task
      </button>
    );
  }
  return (
    <form ref={form} onSubmit={action} className="mb-6 grid gap-2 rounded-xl border border-line bg-panel p-4 sm:grid-cols-6">
      <input name="title" required maxLength={200} placeholder="What needs doing?" className={`${input} sm:col-span-6`} autoFocus />
      <select name="severity" defaultValue="medium" className={`${input} sm:col-span-1`} aria-label="Severity">
        <option value="critical">Critical</option>
        <option value="high">High</option>
        <option value="medium">Medium</option>
        <option value="low">Low</option>
      </select>
      <input name="business" list="add-biz" defaultValue={defaultBusiness} placeholder="Business" maxLength={80} className={`${input} sm:col-span-2`} />
      <datalist id="add-biz">{businesses.map((b) => <option key={b} value={b} />)}</datalist>
      <input name="url" type="url" placeholder="Link (optional)" className={`${input} sm:col-span-3`} />
      <input name="detail" placeholder="Notes (optional)" maxLength={500} className={`${input} sm:col-span-6`} />
      <div className="flex items-center gap-3 sm:col-span-6">
        <button disabled={pending} className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-bg hover:opacity-90 disabled:opacity-50">{pending ? "Adding…" : "Add task"}</button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-muted hover:text-ink">Close</button>
        {state.error && <span className="text-sm text-critical">{state.error}</span>}
        {state.ok && !state.error && <span className="text-sm text-ok">Added.</span>}
      </div>
    </form>
  );
}
