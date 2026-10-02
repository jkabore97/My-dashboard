"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { requireOwner, requireUser } from "@/lib/server/auth";
import { alertAction } from "@/lib/server/alerts/actions";
import { nextLocalHour, normalizePrefs, validZone } from "@/lib/server/alerts/decide";
import { getPrefs, markAllRead, savePrefs } from "@/lib/server/alerts/store";
import { createTickToken } from "@/lib/server/alerts/tick";
import { audit } from "@/lib/server/store/audit";
import { businessTimeZone } from "@/lib/dates";

export interface PrefsState {
  ok?: string;
  error?: string;
}

const refresh = () => revalidatePath("/", "layout");

export async function saveNotifyPrefs(_prev: PrefsState, form: FormData): Promise<PrefsState> {
  const user = await requireUser();
  const tz = String(form.get("timeZone") ?? "").trim();
  if (tz && !validZone(tz)) return { error: "Pick a time zone from the list." };
  const from = Number(form.get("quietFrom"));
  const to = Number(form.get("quietTo"));
  if (![from, to].every((h) => Number.isInteger(h) && h >= 0 && h <= 23)) return { error: "Quiet hours are whole hours from 0 to 23." };
  const current = await getPrefs(user.email);
  await savePrefs(user.email, normalizePrefs({
    ...current,
    timeZone: tz || null,
    quietFrom: from,
    quietTo: to,
    high: form.get("high") === "on",
    digest: form.get("digest") === "on",
    resolved: form.get("resolved") === "on",
  }));
  await audit(user.email, "notify.prefs", null, { timeZone: tz || null, quietFrom: from, quietTo: to });
  refresh();
  return { ok: "Saved." };
}

export type PausePreset = "1h" | "4h" | "morning" | "off";

/** Pauses non-critical pushes (critical always comes through). */
export async function pauseAlerts(preset: PausePreset): Promise<PrefsState> {
  const user = await requireUser();
  const prefs = await getPrefs(user.email);
  const tz = prefs.timeZone ?? businessTimeZone();
  const now = new Date();
  const until =
    preset === "1h" ? new Date(now.getTime() + 3_600_000)
    : preset === "4h" ? new Date(now.getTime() + 4 * 3_600_000)
    : preset === "morning" ? nextLocalHour(now, 7, tz) // the coming 7 AM in their zone (tomorrow's, or this morning's after midnight)
    : null;
  if (preset !== "off" && !until) return { error: "Unknown pause." };
  await savePrefs(user.email, { ...prefs, pausedUntil: until ? until.toISOString() : null });
  refresh();
  return { ok: until ? `Paused until ${until.toLocaleString("en-US", { timeZone: tz, weekday: "short", hour: "numeric", minute: "2-digit" })}.` : "Resumed." };
}

export async function markAllReadAction(): Promise<void> {
  const user = await requireUser();
  await markAllRead(user.email);
  refresh();
}

export async function alertEntryAction(id: string, action: "ack" | "read"): Promise<{ error?: string }> {
  const user = await requireUser();
  const r = await alertAction(user, String(id).slice(0, 40), action === "ack" ? "ack" : "read");
  if (action === "ack") refresh();
  return r.ok ? {} : { error: r.error };
}

/** Owner: a new scheduler link (the old one stops working). Shown once. */
export async function createSchedulerLink(): Promise<{ ok?: string; error?: string; url?: string }> {
  const user = await requireOwner();
  const token = await createTickToken();
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "your-dashboard.vercel.app";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  await audit(user.email, "settings.tick_token", null, null);
  revalidatePath("/settings");
  return { ok: "New scheduler link created. Copy it now; it won't be shown again. Any previous link stops working.", url: `${proto}://${host}/api/tick/${token}` };
}
