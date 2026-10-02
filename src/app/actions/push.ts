"use server";

import { headers } from "next/headers";
import { requireUser } from "@/lib/server/auth";
import { pushEnabled, removeSubscription, saveSubscription, validSubscription } from "@/lib/server/notify";
import { sendTest } from "@/lib/server/alerts/run";
import { getPrefs, savePrefs } from "@/lib/server/alerts/store";
import { validZone } from "@/lib/server/alerts/decide";
import { audit } from "@/lib/server/store/audit";
import { errorMessage } from "@/lib/source";

export async function subscribePush(sub: unknown, timeZone?: string): Promise<{ ok?: boolean; error?: string }> {
  const user = await requireUser();
  if (!pushEnabled()) return { error: "Push isn't configured on the server (VAPID keys)." };
  if (!validSubscription(sub)) return { error: "The browser returned an invalid subscription." };
  await saveSubscription(user.email, sub, (await headers()).get("user-agent"));
  // Quiet hours follow this device's zone until the person picks one.
  if (validZone(timeZone)) {
    const prefs = await getPrefs(user.email);
    if (!prefs.timeZone) await savePrefs(user.email, { ...prefs, timeZone }).catch(() => {});
  }
  await audit(user.email, "push.subscribe", new URL(sub.endpoint).host, null);
  return { ok: true };
}

export async function unsubscribePush(endpoint: string): Promise<void> {
  const user = await requireUser();
  await removeSubscription(String(endpoint).slice(0, 1000));
  await audit(user.email, "push.unsubscribe", null, null);
}

export async function testPush(): Promise<{ ok?: string; error?: string }> {
  const user = await requireUser();
  try {
    const r = await sendTest(user.email);
    return r.status === "sent" ? { ok: "Sent. It should arrive in a few seconds." } : { error: r.reason ?? "No device is subscribed yet." };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}
