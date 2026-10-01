import { NextResponse } from "next/server";
import { apply } from "./webhook-handlers";
import { webhookSecret, type WebhookProvider } from "./webhooks";

const MAX_BODY = 1_000_000;

/**
 * Shared shape of every webhook endpoint: read the raw body (signatures are
 * computed over the exact bytes), verify, parse, handle, store.
 */
export async function receiveWebhook(
  req: Request,
  provider: WebhookProvider,
  verify: (secret: string, raw: string) => boolean,
  handle: (raw: string, payload: Record<string, unknown>) => Parameters<typeof apply>[0],
) {
  const secret = await webhookSecret(provider);
  if (!secret) return NextResponse.json({ error: `${provider} webhook secret not configured` }, { status: 503 });
  const raw = await req.text();
  if (raw.length > MAX_BODY) return NextResponse.json({ error: "payload too large" }, { status: 413 });
  if (!verify(secret, raw)) return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const result = await apply(handle(raw, payload));
  return NextResponse.json({ ok: true, ...result });
}
