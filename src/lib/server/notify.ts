import webpush from "web-push";
import { env, errorMessage } from "../source";
import { getDb } from "./db";

// Outbound notifications: email (Resend) for the morning brief and weekly
// report, and Web Push to the installed dashboard app. Which alerts go to
// whom, and when, is decided in ./alerts.

export const emailEnabled = () => !!(env("RESEND_API_KEY") && env("BRIEF_EMAIL_TO") && env("BRIEF_EMAIL_FROM"));

export async function sendEmail(subject: string, html: string, text: string, to = env("BRIEF_EMAIL_TO")): Promise<void> {
  if (!emailEnabled() || !to) throw new Error("Email isn't configured (RESEND_API_KEY, BRIEF_EMAIL_FROM, BRIEF_EMAIL_TO)");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env("RESEND_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env("BRIEF_EMAIL_FROM"), to: to.split(",").map((s) => s.trim()).filter(Boolean), subject, html, text }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Email send failed (${res.status}): ${(await res.text().catch(() => "")).slice(0, 200)}`);
}

// ─── Web Push ────────────────────────────────────────────────────────────────

export const pushEnabled = () => !!(env("VAPID_PUBLIC_KEY") && env("VAPID_PRIVATE_KEY"));
export const vapidPublicKey = () => env("VAPID_PUBLIC_KEY") ?? null;

let configured = false;
function vapid() {
  if (!pushEnabled()) throw new Error("Push isn't configured (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY)");
  if (!configured) {
    webpush.setVapidDetails(env("VAPID_SUBJECT") ?? `mailto:${env("BRIEF_EMAIL_TO")?.split(",")[0] ?? "owner@example.com"}`, env("VAPID_PUBLIC_KEY")!, env("VAPID_PRIVATE_KEY")!);
    configured = true;
  }
}

export interface PushSubscriptionJSON {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export function validSubscription(s: unknown): s is PushSubscriptionJSON {
  const x = s as PushSubscriptionJSON;
  return !!x && typeof x.endpoint === "string" && /^https:\/\//.test(x.endpoint) && x.endpoint.length < 1000 && typeof x.keys?.p256dh === "string" && typeof x.keys?.auth === "string";
}

export async function saveSubscription(email: string, sub: PushSubscriptionJSON, userAgent: string | null) {
  const db = await getDb();
  await db.query(
    `insert into push_subscriptions (endpoint, owner, keys, user_agent) values ($1, $2, $3::text::jsonb, $4)
     on conflict (endpoint) do update set owner = excluded.owner, keys = excluded.keys, user_agent = excluded.user_agent, created_at = now()`,
    [sub.endpoint, email, JSON.stringify(sub.keys), userAgent?.slice(0, 200) ?? null],
  );
}

export async function removeSubscription(endpoint: string) {
  const db = await getDb();
  await db.query("delete from push_subscriptions where endpoint = $1", [endpoint]);
}

export async function countSubscriptions() {
  const db = await getDb();
  const [r] = await db.query<{ n: number }>("select count(*)::int as n from push_subscriptions");
  return Number(r.n);
}

/**
 * What the service worker shows. `id` is the delivery-log row (for the
 * Acknowledge / Snooze actions), `tag` replaces an earlier notification with
 * the same tag (a "Resolved" push replaces the alert). Never put secrets here.
 */
export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  id?: string;
  kind?: string;
  severity?: string;
  actions?: { action: string; title: string }[];
  requireInteraction?: boolean;
  /** The app icon badge to show (unread critical/high alerts); the service worker sets it where supported. */
  appBadge?: number;
};

/** Sends to every subscribed device; drops subscriptions the push service says are gone. */
export async function pushAll(payload: PushPayload) {
  return pushTo(null, payload);
}

/** Sends to the devices of these people (null = everyone). */
export async function pushTo(emails: string | string[] | null, payload: PushPayload) {
  vapid();
  const db = await getDb();
  const list = emails === null ? null : Array.isArray(emails) ? emails : [emails];
  if (list && !list.length) return { sent: 0, errors: [] as string[] };
  const subs = list
    ? await db.query<{ endpoint: string; keys: { p256dh: string; auth: string } }>("select endpoint, keys from push_subscriptions where owner = any($1::text[])", [list])
    : await db.query<{ endpoint: string; keys: { p256dh: string; auth: string } }>("select endpoint, keys from push_subscriptions");
  let sent = 0;
  const errors: string[] = [];
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify(payload), { TTL: 60 * 60 * 12, urgency: "high" });
        sent++;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) await removeSubscription(s.endpoint);
        else errors.push(errorMessage(err));
      }
    }),
  );
  return { sent, errors };
}

const SEVERITY_WORD: Record<string, string> = { critical: "Critical", high: "High", medium: "Medium", low: "Low" };

/**
 * Push text for a task. Email subjects are written by outside senders, so the
 * sender is named and the text kept short.
 */
export function pushText(t: { title: string; detail: string | null; source_key: string | null; origin: string }, severity = "critical") {
  const word = SEVERITY_WORD[severity] ?? "Alert";
  const email = t.origin === "derived" && /^(gmail|outlook|mymail)\/(?!.*\/reconnect$)/.test(t.source_key ?? "");
  if (email) {
    const from = (t.detail ?? "").replace(/^From\s+/, "").slice(0, 80) || "unknown sender";
    return { title: `${word} email`, body: `${from}: ${t.title.slice(0, 80)}` };
  }
  return { title: `${word}: ${t.title}`.slice(0, 120), body: (t.detail ?? "Open the dashboard for details.").slice(0, 200) };
}
