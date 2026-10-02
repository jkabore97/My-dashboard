"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/server/auth";
import { audit } from "@/lib/server/store/audit";
import { addManualTask, completeTask, deleteManualTask, getTask, reopenTask, setTaskBusiness, snoozeTask } from "@/lib/server/store/tasks";
import { SEVERITY_ORDER, type Severity } from "@/lib/types";
import { completeDeadline } from "@/lib/server/store/ledger";
import { requestSync } from "@/lib/server/sync";
import { today } from "@/lib/dates";

const SNOOZE_HOURS = { "4h": 4, "1d": 24, "3d": 72, "1w": 168 } as const;
export type SnoozePreset = keyof typeof SNOOZE_HOURS;

const done = () => revalidatePath("/", "layout");
const clean = (v: FormDataEntryValue | null, max: number) => String(v ?? "").trim().slice(0, max);

async function act(id: string, action: string, fn: () => Promise<unknown>, detail?: unknown) {
  const user = await requireUser();
  const task = await getTask(id);
  if (!task) return;
  await fn();
  await audit(user.email, action, task.title, detail);
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
  await act(id, "task.snooze", () => snoozeTask(id, new Date(Date.now() + hours * 3_600_000)), { preset });
}

export async function setTaskBusinessAction(id: string, business: string) {
  const value = business.trim().slice(0, 80) || null;
  await act(id, "task.business", () => setTaskBusiness(id, value), { business: value });
}

export async function deleteTaskAction(id: string) {
  await act(id, "task.delete", () => deleteManualTask(id));
}

export async function addTaskAction(_prev: { error?: string; ok?: number }, form: FormData): Promise<{ error?: string; ok?: number }> {
  const user = await requireUser();
  const title = clean(form.get("title"), 200);
  const severity = clean(form.get("severity"), 10) as Severity;
  const url = clean(form.get("url"), 500);
  if (!title) return { error: "Give the task a title." };
  if (!SEVERITY_ORDER.includes(severity)) return { error: "Pick a severity." };
  if (url && !/^https?:\/\//i.test(url)) return { error: "Links must start with http:// or https://" };
  await addManualTask({ title, severity, detail: clean(form.get("detail"), 500) || undefined, business: clean(form.get("business"), 80) || undefined, url: url || undefined });
  await audit(user.email, "task.create", title, { severity });
  done();
  return { ok: Date.now() };
}
