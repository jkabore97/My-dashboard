import { NextResponse } from "next/server";
import { isapi } from "@/lib/connectors/hikvision";
import { requireUser } from "@/lib/server/auth";
import { hikvisionSite } from "@/lib/server/site-credentials";
import { errorMessage } from "@/lib/source";

// A still image from one camera, fetched from the NVR through the tunnel with
// the stored login. The browser never sees the NVR address or password.

export async function GET(_req: Request, ctx: { params: Promise<{ site: string; channel: string }> }) {
  await requireUser();
  const { site: siteId, channel } = await ctx.params;
  const ch = Number(channel);
  if (!Number.isInteger(ch) || ch < 1 || ch > 256) return NextResponse.json({ error: "bad channel" }, { status: 400 });
  const site = await hikvisionSite(decodeURIComponent(siteId));
  if (!site) return NextResponse.json({ error: "unknown site" }, { status: 404 });
  try {
    // Sub-stream (x02) is smaller and quicker; fall back to the main stream.
    let res = await isapi(site, `/ISAPI/Streaming/channels/${ch}02/picture`, "image/jpeg");
    if (!res.ok) res = await isapi(site, `/ISAPI/Streaming/channels/${ch}01/picture`, "image/jpeg");
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !type.startsWith("image/")) return NextResponse.json({ error: `camera returned ${res.status}` }, { status: 502 });
    const body = await res.arrayBuffer();
    if (body.byteLength > 5_000_000) return NextResponse.json({ error: "image too large" }, { status: 502 });
    return new NextResponse(body, { headers: { "Content-Type": type, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 502 });
  }
}
