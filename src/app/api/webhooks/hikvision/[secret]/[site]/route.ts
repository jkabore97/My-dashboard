import { after, NextResponse } from "next/server";
import { alertsAfter } from "@/lib/server/alerts/after";
import { parseEventAlert } from "@/lib/connectors/hikvision";
import { safeEqual } from "@/lib/server/crypto";
import { latestSnapshot } from "@/lib/server/store/snapshots";
import { hikvisionSite } from "@/lib/server/site-credentials";
import { apply, handleHikvision } from "@/lib/server/webhook-handlers";
import { webhookSecret } from "@/lib/server/webhooks";
import type { CameraSiteStatus } from "@/lib/connectors/hikvision";

// The NVR's "alarm server" (HTTP listening) posts EventNotificationAlert XML,
// sometimes inside multipart/form-data with a picture. It can't sign
// requests, so the secret is part of the path.

const MAX_BODY = 2_000_000;

export async function POST(req: Request, ctx: { params: Promise<{ secret: string; site: string }> }) {
  const { secret, site: siteId } = await ctx.params;
  const expected = await webhookSecret("hikvision");
  if (!expected) return NextResponse.json({ error: "hikvision webhook secret not configured" }, { status: 503 });
  if (!safeEqual(secret, expected)) return NextResponse.json({ error: "invalid secret" }, { status: 401 });
  const site = await hikvisionSite(siteId);
  if (!site) return NextResponse.json({ error: "unknown site; use the site id shown on the Cameras page" }, { status: 404 });

  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_BODY) return NextResponse.json({ error: "payload too large" }, { status: 413 });
  const raw = (await req.text()).slice(0, MAX_BODY);
  // Pull the XML out of a multipart body; pictures are ignored.
  const xml = raw.match(/<EventNotificationAlert[\s\S]*?<\/EventNotificationAlert>/)?.[0];
  const event = xml ? parseEventAlert(xml) : null;
  if (!event) return NextResponse.json({ ok: true, ignored: true });

  const status = await latestSnapshot<CameraSiteStatus>("cameras", site.id).catch(() => null);
  const channelName = event.channel ? status?.channels.find((c) => c.id === event.channel)?.name : null;
  const result = await apply(handleHikvision(site, event, channelName));
  if (result.tasks || result.resolved) alertsAfter(after);
  return NextResponse.json({ ok: true, ...result });
}
