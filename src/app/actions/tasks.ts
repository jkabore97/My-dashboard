"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { alertsAfter } from "@/lib/server/alerts/after";
import { restartIncident } from "@/lib/server/alerts/run";
import { businessDenied, requireSection, type CurrentUser } from "@/lib/server/auth";
import { audit } from "@/lib/server/store/audit";
import { addManualTask, completeTask, deleteManualTask, getTask, recordActivity, reopenTask, setTaskAssignee, setTaskBusiness, snoozeTask, type StoredTask } from "@/lib/server/store/tasks";
import { canSeeTask } from "@/lib/access";
import { assignableFor } from "@/lib/server/people";
import { pushTo } from "@/lib/server/notify";
import { SEVERITY_ORDER, type Severity } from "@/lib/types";
import { completeDeadline } from "@/lib/server/store/ledger";
import { requestSync } from "@/lib/server/sync";
import { today } from "@/lib/dates";

const SNOOZE_HOURS = { "4h": 4, "1d": 24, "3d": 72, "1w": 168 } as const;
export type SnoozePreset = keyof typeof SNOOZE_HOURS;

const done = () => revalidatePath("/", "layout");
const clean = (v: FormDataEntryValue | null, max: number) => String(v ?? "").trim().slice(0, max);

/** Every task change: signed in with the To-do page, the task visible to them, then audited and logged on the task. */
async function act(id: string, action: string, fn: (task: StoredTask, user: CurrentUser) => Promise<unknown>, detail?: Record<string, unknown>) {
  const user = await requireSection("tasks");
  const task = await getTask(id);
  if (!task || !canSeeTask(user, user.email, task)) return;
  if ((await fn(task, user)) === false) return;
  await audit(user.email, action, task.title, detail);
  await recordActivity(id, user.email, action.replace(/^task\./, ""), detail ?? null).catch(() => {});
  // Reopened or closed: the alert or the "Resolved" message follows at once.
  if (action === "task.reopen" || action === "task.done") alertsAfter(after);
  done();
}

export async function completeTaskAction(id: string) {
  await act(id, "task.done", async () => {
    await completeTask(id);
    // Finishing a deadline's task completes that occurrence (recurring ones move to their next date).
    const task = await getTask(id);
    const m = task?.origin === "derived" ? task.sourceKey?.match(/^deadlines\/([0-9a-f-]{36}):(\d{4}-\d{2}-\d{2})$/) : null;
    if (m && (await completeDeadline(m[1], today(), m[2]))) await requestSync();
  });
}

export async function reopenTaskAction(id: string) {
  await act(id, "task.reopen", () => reopenTask(id));
}

export async function snoozeTaskAction(id: string, preset: SnoozePreset) {
  const hours = SNOOZE_HOURS[preset];
  if (!hours) return;
  await act(id, "task.snooze", async () => {
    const until = new Date(Date.now() + hours * 3_600_000);
    await snoozeTask(id, until);
    await restartIncident(id, until).catch(() => {}); // alerts again if still open when the snooze ends
  }, { preset });
}

export async function setTaskBusinessAction(id: string, business: string) {
  const value = business.trim().slice(0, 80) || null;
  await act(id, "task.business", async (_t, user) => {
    // A scoped teammate can only move tasks between their own businesses.
    if (businessDenied(user, value)) return false;
    await setTaskBusiness(id, value);
  }, { business: value });
}

/** Assigns a task to someone who can see its business (or unassigns with ""). They get a push. */
export async function assignTaskAction(id: string, email: string) {
  const to = email.trim().toLowerCase() || null;
  await act(id, "task.assign", async (task, user) => {
    if (to && !(await assignableFor(task.business)).some((p) => p.email === to)) return false;
    await setTaskAssignee(id, to);
    if (to && to !== user.email) {
      await pushTo(to, { title: `Assigned to you: ${task.title}`.slice(0, 120), body: `From ${user.name}. ${task.severity} priority.`, url: "/tasks?view=mine", tag: `assign-${id}` }).catch(() => {});
    }
  }, { assignee: to });
}

export async function deleteTaskAction(id: string) {
  await act(id, "task.delete", () => deleteManualTask(id));
}

export async function addTaskAction(_prev: { error?: string; ok?: number }, form: FormData): Promise<{ error?: string; ok?: number }> {
  const user = await requireSection("tasks");
  const title = clean(form.get("title"), 200);
  const severity = clean(form.get("severity"), 10) as Severity;
  const url = clean(form.get("url"), 500);
  if (!title) return { error: "Give the task a title." };
  if (!SEVERITY_ORDER.includes(severity)) return { error: "Pick a severity." };
  if (url && !/^https?:\/\//i.test(url)) return { error: "Links must start with http:// or https://" };
  // Someone who works for one business files tasks there by default.
  const business = clean(form.get("business"), 80) || (user.businesses?.length === 1 ? user.businesses[0] : null);
  const denied = businessDenied(user, business);
  if (denied) return { error: business ? denied : `Pick a business (${user.businesses!.join(", ")}).` };
  const assignee = clean(form.get("assignee"), 200).toLowerCase() || null;
  if (assignee && !(await assignableFor(business)).some((p) => p.email === assignee)) return { error: "That person can't see this business." };
  const task = await addManualTask({ title, severity, detail: clean(form.get("detail"), 500) || undefined, business: business ?? undefined, url: url || undefined, assignee });
  await audit(user.email, "task.create", title, { severity, assignee });
  await recordActivity(task.id, user.email, "create", assignee ? { assignee } : null).catch(() => {});
  if (assignee && assignee !== user.email) await pushTo(assignee, { title: `Assigned to you: ${title}`.slice(0, 120), body: `From ${user.name}. ${severity} priority.`, url: "/tasks?view=mine", tag: `assign-${task.id}` }).catch(() => {});
  alertsAfter(after); // a new critical/high task alerts the others who can see it
  done();
  return { ok: Date.now() };
}
