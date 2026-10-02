import { cache } from "react";
import { collect, type DerivedTask } from "../aggregate";
import type { Notification, Task } from "../types";
import { requireUser } from "./auth";
import { listEvents } from "./store/events";
import { listTasks, sortTasks, type StoredTask, type TaskStatus } from "./store/tasks";
import { persist } from "./sync";
import { fixForTask } from "../fix-match";

export interface TaskView extends Task {
  status: TaskStatus;
  origin: StoredTask["origin"] | "demo";
  /** False for demo tasks (nothing to persist) and when the database is down. */
  actionable: boolean;
  snoozedUntil: string | null;
  /** Label of the one-click fix for this task, if there is one. */
  fix: string | null;
}

const fromDerived = (t: DerivedTask): TaskView => ({ ...t, status: "open", origin: "demo", actionable: false, snoozedUntil: null, fix: null });
const fromStored = (t: StoredTask): TaskView => ({ ...t, actionable: true, fix: t.status === "open" ? (fixForTask(t.sourceKey, t.url)?.label ?? null) : null });

/**
 * Everything a page needs: live platform data plus persisted tasks and event
 * history. If the database is unreachable the dashboard still renders from
 * live data, with tasks read-only.
 *
 * Auth is checked here, not only in the (dash) layout: client-side navigation
 * re-renders just the page segment, so the layout's check doesn't run then.
 */
export const getDashboard = cache(async () => {
  await requireUser();
  const c = await collect();
  let dbError: string | null = null;
  let openTasks: TaskView[];
  let notifications: Notification[];
  // Sample tasks only make sense while nothing is connected; once real data
  // flows they would just be noise in the real to-do list.
  const demoTasks = c.allDemo ? c.derivedTasks.filter((t) => !t.live).map(fromDerived) : [];
  try {
    await persist(c);
    const stored = await listTasks("open");
    openTasks = sortTasks([...stored.map(fromStored), ...demoTasks]);
    const events = await listEvents(200);
    const seen = new Set(events.map((e) => e.title + e.at));
    // Same for sample notifications: never mixed into real history.
    const samples = c.allDemo ? c.notifications.filter((n) => !n.live && !seen.has(n.title + n.at)) : [];
    notifications = [...events, ...samples].sort((a, b) => b.at.localeCompare(a.at));
  } catch (err) {
    dbError = err instanceof Error ? err.message : String(err);
    openTasks = sortTasks(c.derivedTasks.map(fromDerived));
    notifications = c.notifications;
  }
  return { ...c, openTasks, notifications, dbError };
});

export type Dashboard = Awaited<ReturnType<typeof getDashboard>>;

export async function getTasksByStatus(status: TaskStatus): Promise<TaskView[]> {
  await requireUser();
  return (await listTasks(status)).map(fromStored);
}
