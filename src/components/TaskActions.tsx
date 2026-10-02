"use client";

import { useState, useTransition } from "react";
import { Check, ChevronDown, Clock, RotateCcw, Tag, Trash2, UserRound } from "lucide-react";
import { assignTaskAction, completeTaskAction, deleteTaskAction, reopenTaskAction, setTaskBusinessAction, snoozeTaskAction, type SnoozePreset } from "@/app/actions/tasks";
import type { TaskStatus } from "@/lib/server/store/tasks";
import { ab } from "./command/hud";

export function TaskActions({ id, status, manual, business, businesses, assignee = null, people = [] }: { id: string; status: TaskStatus; manual: boolean; business?: string; businesses: string[]; assignee?: string | null; people?: { email: string; name: string }[] }) {
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const run = (fn: () => Promise<void>) => start(() => fn());

  if (editing) {
    return (
      <form
        className="flex flex-wrap items-center gap-1.5"
        action={(form) => {
          setEditing(false);
          run(() => setTaskBusinessAction(id, String(form.get("business") ?? "")));
        }}
      >
        <input name="business" list={`biz-${id}`} defaultValue={business ?? ""} placeholder="Business" autoFocus className="hud-input min-h-10 w-40 px-2.5 text-[13px] sm:min-h-8" />
        <datalist id={`biz-${id}`}>{businesses.map((b) => <option key={b} value={b} />)}</datalist>
        <button className={ab}>Save</button>
        <button type="button" className={ab} onClick={() => setEditing(false)}>Cancel</button>
      </form>
    );
  }

  const assignedName = assignee ? (people.find((p) => p.email === assignee)?.name ?? assignee) : null;
  return (
    <div className={`flex flex-wrap items-center gap-1.5 sm:justify-end ${pending ? "opacity-50" : ""}`}>
      {status === "open" ? (
        <>
          <button className={`${ab} border-emerald/55 text-[#bffbe0]`} disabled={pending} onClick={() => run(() => completeTaskAction(id))} title="Mark done"><Check size={13} />Done</button>
          <label className={`${ab} relative cursor-pointer`} title="Snooze">
            <Clock size={13} />Snooze<ChevronDown size={11} className="text-muted" />
            <select
              aria-label="Snooze"
              className="absolute inset-0 cursor-pointer opacity-0"
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
        <button className={ab} disabled={pending} onClick={() => run(() => reopenTaskAction(id))} title="Reopen"><RotateCcw size={13} />Reopen</button>
      )}
      {people.length > 0 && (
        <label className={`${ab} relative max-w-40 cursor-pointer`} title="Assign to someone">
          <UserRound size={13} className="shrink-0" />
          <span className="truncate">{assignedName ?? "Assign"}</span>
          <ChevronDown size={11} className="shrink-0 text-muted" />
          <select
            aria-label="Assign to"
            className="absolute inset-0 cursor-pointer opacity-0"
            disabled={pending}
            value={assignee ?? ""}
            onChange={(e) => run(() => assignTaskAction(id, e.target.value))}
          >
            <option value="">Unassigned</option>
            {people.map((p) => <option key={p.email} value={p.email}>{p.name}</option>)}
            {assignee && !people.some((p) => p.email === assignee) && <option value={assignee}>{assignee}</option>}
          </select>
        </label>
      )}
      <button className={`${ab} min-w-10 justify-center sm:min-w-8`} disabled={pending} onClick={() => setEditing(true)} title="Assign business" aria-label="Assign business"><Tag size={13} /></button>
      {manual && (
        <button className={`${ab} min-w-10 justify-center sm:min-w-8`} disabled={pending} onClick={() => confirm("Delete this task?") && run(() => deleteTaskAction(id))} title="Delete" aria-label="Delete"><Trash2 size={13} /></button>
      )}
    </div>
  );
}
