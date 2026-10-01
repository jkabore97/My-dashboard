import { NextResponse } from "next/server";
import { safeEqual } from "@/lib/server/crypto";
import { runScheduledChecks } from "@/lib/server/sync";

export const maxDuration = 60;

// Vercel Cron calls this every 5 minutes (vercel.json) with
// "Authorization: Bearer $CRON_SECRET". Any other scheduler can do the same.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 503 });
  if (!safeEqual(req.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await runScheduledChecks()) });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
