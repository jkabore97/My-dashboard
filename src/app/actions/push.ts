"use server";

import { headers } from "next/headers";
import { requireUser } from "@/lib/server/auth";
import { pushAll, pushEnabled, removeSubscription, saveSubscription, validSubscription } from "@/lib/server/notify";
import { audit } from "@/lib/server/store/audit";
import { errorMessage } from "@/lib/source";

export async function subscribePush(sub: unknown): Promise<{ ok?: boolean; error?: string }> {
  const user = await requireUser();
  if (!pushEnabled()) return { error: "Push isn't configured on the server (VAPID keys)." };
  if (!validSubscription(sub)) return { error: "The browser returned an invalid subscription." };
  await saveSubscription(user.email, sub, (await headers()).get("user-agent"));
  await audit(user.email, "push.subscribe", new URL(sub.endpoint).host, null);
  return { ok: true };
}

export async function unsubscribePush(endpoint: string): Promise<void> {
  const user = await requireUser();
  await removeSubscription(String(endpoint).slice(0, 1000));
  await audit(user.email, "push.unsubscribe", null, null);
}

export async function testPush(): Promise<{ ok?: string; error?: string }> {
  await requireUser();
  try {
    const r = await pushAll({ title: "Kaj Command Center", body: "Notifications are working. Critical items will show up here.", url: "/", tag: "test" });
    return r.sent ? { ok: `Sent to ${r.sent} device${r.sent > 1 ? "s" : ""}.` } : { error: r.errors[0] ?? "No device is subscribed yet." };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}
