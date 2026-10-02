import { cache } from "react";
import { collect, type DerivedTask } from "../aggregate";
import type { Notification, Task } from "../types";
import { requireUser, type CurrentUser } from "./auth";
import { businessForDomain, getConfig } from "./config";
import { scopeFor } from "../scope";
import { canSeeTask } from "../access";
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
  sourceKey?: string | null;
  assignee?: string | null;
}

const fromDerived = (t: DerivedTask): TaskView => ({ ...t, sourceKey: t.id, status: "open", origin: "demo", actionable: false, snoozedUntil: null, fix: null });
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
  const user = await requireUser();
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
  // Everyone but a full owner gets a copy cut down to their role and businesses.
  const { sites } = await getConfig();
  const scoped = scopeFor({ ...c, openTasks, notifications, dbError }, user, user.email, { businessForDomain: (d) => businessForDomain(d, sites) });
  return { ...scoped, user };
});

export type Dashboard = Awaited<ReturnType<typeof getDashboard>>;

export async function getTasksByStatus(status: TaskStatus): Promise<TaskView[]> {
  const user = await requireUser();
  return (await listTasks(status)).filter((t) => canSeeTask(user, user.email, t)).map(fromStored);
}

export type { CurrentUser };
