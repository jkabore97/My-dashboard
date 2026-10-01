"use client";

import { useState, useTransition } from "react";
import { Check, Clock, RotateCcw, Tag, Trash2 } from "lucide-react";
import { completeTaskAction, deleteTaskAction, reopenTaskAction, setTaskBusinessAction, snoozeTaskAction, type SnoozePreset } from "@/app/actions/tasks";
import type { TaskStatus } from "@/lib/server/store/tasks";

const btn = "inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs text-muted hover:border-accent/50 hover:text-ink disabled:opacity-50";

export function TaskActions({ id, status, manual, business, businesses }: { id: string; status: TaskStatus; manual: boolean; business?: string; businesses: string[] }) {
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const run = (fn: () => Promise<void>) => start(() => fn());

  if (editing) {
    return (
      <form
        className="flex items-center gap-1"
        action={(form) => {
          setEditing(false);
          run(() => setTaskBusinessAction(id, String(form.get("business") ?? "")));
        }}
      >
        <input name="business" list={`biz-${id}`} defaultValue={business ?? ""} placeholder="Business" autoFocus className="w-36 rounded-md border border-line bg-bg px-2 py-1 text-xs outline-none focus:border-accent" />
        <datalist id={`biz-${id}`}>{businesses.map((b) => <option key={b} value={b} />)}</datalist>
        <button className={btn}>Save</button>
        <button type="button" className={btn} onClick={() => setEditing(false)}>Cancel</button>
      </form>
    );
  }

  return (
    <div className={`flex shrink-0 items-center gap-1 ${pending ? "opacity-50" : ""}`}>
      {status === "open" ? (
        <>
          <button className={btn} disabled={pending} onClick={() => run(() => completeTaskAction(id))} title="Mark done"><Check size={12} />Done</button>
          <label className={`${btn} cursor-pointer`} title="Snooze">
            <Clock size={12} />
            <select
              aria-label="Snooze"
              className="cursor-pointer bg-transparent outline-none"
              disabled={pending}
              value=""
              onChange={(e) => e.target.value && run(() => snoozeTaskAction(id, e.target.value as SnoozePreset))}
            >
              <option value="">Snooze</option>
              <option value="4h">4 hours</option>
              <option value="1d">1 day</option>
              <option value="3d">3 days</option>
              <option value="1w">1 week</option>
            </select>
          </label>
        </>
      ) : (
        <button className={btn} disabled={pending} onClick={() => run(() => reopenTaskAction(id))} title="Reopen"><RotateCcw size={12} />Reopen</button>
      )}
      <button className={btn} disabled={pending} onClick={() => setEditing(true)} title="Assign business" aria-label="Assign business"><Tag size={12} /></button>
      {manual && (
        <button className={btn} disabled={pending} onClick={() => confirm("Delete this task?") && run(() => deleteTaskAction(id))} title="Delete" aria-label="Delete"><Trash2 size={12} /></button>
      )}
    </div>
  );
}
