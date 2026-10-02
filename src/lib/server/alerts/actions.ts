import { canSee, canSeeTask } from "../../access";
import type { CurrentUser } from "../auth";
import { audit } from "../store/audit";
import { getTask, recordActivity, snoozeTask } from "../store/tasks";
import { acknowledge, markRead, ownEntry } from "./store";

export type AlertAction = "ack" | "snooze" | "read";
export const SNOOZE_FROM_PUSH_MS = 3_600_000;

/**
 * An action on one delivery-log row, from a notification or the bell. The row
 * must belong to the signed-in person; snoozing also needs the To-do page and
 * the task visible to them, exactly like the To-do page's own Snooze.
 */
export async function alertAction(user: CurrentUser, id: string, action: AlertAction): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const entry = await ownEntry(user.email, id);
  if (!entry) return { ok: false, status: 404, error: "not found" };
  if (action === "read") {
    await markRead(user.email, entry.id);
    return { ok: true };
  }
  if (!entry.taskId) {
    await markRead(user.email, entry.id);
    return { ok: true };
  }
  const task = await getTask(entry.taskId);
  if (!task || !canSeeTask(user, user.email, task)) return { ok: false, status: 403, error: "no access to this task" };
  if (action === "ack") {
    await acknowledge(user.email, entry.taskId);
    await recordActivity(task.id, user.email, "acknowledge", null).catch(() => {});
    return { ok: true };
  }
  if (!canSee(user, "tasks")) return { ok: false, status: 403, error: "no access to the To-do page" };
  if (task.status === "done") return { ok: false, status: 409, error: "already done" };
  await snoozeTask(task.id, new Date(Date.now() + SNOOZE_FROM_PUSH_MS));
  await acknowledge(user.email, entry.taskId); // and stop anything still queued for them about it
  await audit(user.email, "task.snooze", task.title, { preset: "1h", via: "notification" });
  await recordActivity(task.id, user.email, "snooze", { preset: "1h" }).catch(() => {});
  return { ok: true };
}
