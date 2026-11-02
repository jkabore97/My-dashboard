"use client";

import { useState, useTransition } from "react";
import { Check, ChevronDown, Clock, RotateCcw, Tag, Trash2, UserRound } from "lucide-react";
import { assignTaskAction, completeTaskAction, deleteTaskAction, reopenTaskAction, setTaskBusinessAction, snoozeTaskAction, type SnoozePreset } from "@/app/actions/tasks";
import type { TaskStatus } from "@/lib/server/store/tasks";
import type { Severity } from "@/lib/types";
import { ab, SEV_COLOR } from "./command/hud";

const abSolid = ab.replace("bg-fill ", "bg-cyan ").replace("text-cyan", "text-white").replace("hover:bg-fill-2", "hover:brightness-110");
const abRed = ab.replace("text-cyan", "text-critical");

/**
 * The Reminders-style round check at the start of a task row: tap it to mark an
 * open task done, tap a done one to reopen it. Snoozed tasks show a dashed ring
 * (they come back with the Reopen button or on their own).
 */
export function TaskCheck({ id, status, severity, title }: { id: string; status: TaskStatus; severity: Severity; title: string }) {
  const [pending, start] = useTransition();
  const c = SEV_COLOR[severity];
  if (status === "snoozed") {
    return <span role="img" aria-label={`${severity} severity, snoozed`} title="Snoozed" className="mt-px block h-[22px] w-[22px] shrink-0 rounded-full border-[1.5px] border-dashed" style={{ borderColor: c }} />;
  }
  const done = status === "done";
  const filled = done !== pending; // flips at once while the action runs
  return (
    <button
      type="button"
      aria-label={done ? `Reopen “${title}”` : `Mark “${title}” done (${severity} severity)`}
      title={done ? "Reopen" : "Mark done"}
      disabled={pending}
      onClick={() => start(() => (done ? reopenTaskAction(id) : completeTaskAction(id)))}
      className="group -m-2.5 grid shrink-0 place-items-center p-2.5"
    >
      <span className="grid h-[22px] w-[22px] place-items-center rounded-full border-[1.5px] transition-colors" style={{ borderColor: c, background: filled ? c : undefined }}>
        <Check size={13} strokeWidth={3} className={`transition-opacity ${filled ? "text-white opacity-100" : "opacity-0 group-hover:opacity-60"}`} style={filled ? undefined : { color: c }} />
      </span>
    </button>
  );
}

/** The small grey buttons of a task row: snooze, assign, business, delete (done is the round check). */
export function TaskActions({ id, status, manual, personal = false, business, businesses, assignee = null, people = [] }: { id: string; status: TaskStatus; manual: boolean; /** Personal tasks have no business and can't be handed on. */ personal?: boolean; business?: string; businesses: string[]; assignee?: string | null; people?: { email: string; name: string }[] }) {
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
        <input name="business" list={`biz-${id}`} defaultValue={business ?? ""} placeholder="Business" autoFocus className="hud-input min-h-10 w-40 px-2.5 text-[15px] sm:min-h-8 sm:text-[13px]" />
        <datalist id={`biz-${id}`}>{businesses.map((b) => <option key={b} value={b} />)}</datalist>
        <button className={abSolid}>Save</button>
        <button type="button" className={ab} onClick={() => setEditing(false)}>Cancel</button>
      </form>
    );
  }

  const assignedName = assignee ? (people.find((p) => p.email === assignee)?.name ?? assignee) : null;
  return (
    <div className={`flex flex-wrap items-center gap-1.5 sm:justify-end ${pending ? "opacity-50" : ""}`}>
      {status === "open" ? (
        <label className={`${ab} relative cursor-pointer`} title="Snooze">
          <Clock size={13} />Snooze<ChevronDown size={11} className="opacity-60" />
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
      ) : status === "snoozed" ? (
        <button className={ab} disabled={pending} onClick={() => run(() => reopenTaskAction(id))} title="Reopen"><RotateCcw size={13} />Reopen</button>
      ) : null}
      {people.length > 0 && (
        <label className={`${ab} relative max-w-44 cursor-pointer`} title="Assign to someone">
          <UserRound size={13} className="shrink-0" />
          <span className="truncate">{assignedName ?? "Assign"}</span>
          <ChevronDown size={11} className="shrink-0 opacity-60" />
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
      {!personal && <button className={`${ab} min-w-10 justify-center px-0 sm:min-w-8`} disabled={pending} onClick={() => setEditing(true)} title="Assign business" aria-label="Assign business"><Tag size={14} /></button>}
      {manual && (
        <button className={`${abRed} min-w-10 justify-center px-0 sm:min-w-8`} disabled={pending} onClick={() => confirm("Delete this task?") && run(() => deleteTaskAction(id))} title="Delete" aria-label="Delete"><Trash2 size={14} /></button>
      )}
    </div>
  );
}
