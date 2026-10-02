import { NextResponse } from "next/server";
import { authorizeTick, runTick } from "@/lib/server/alerts/tick";

/** Shared by /api/tick (Bearer CRON_SECRET) and /api/tick/<token> (scheduler link). */
export async function tick(req: Request, token: string | null) {
  if (!(await authorizeTick(token, req.headers.get("authorization")))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await runTick(), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, error: "tick failed" }, { status: 500 });
  }
}
