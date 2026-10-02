import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/server/auth";
import { alertAction, type AlertAction } from "@/lib/server/alerts/actions";

// Buttons on a push notification ("Acknowledge", "Snooze 1h"). The service
// worker posts {id, action} with the session cookie; the row must be yours.

const ACTIONS: AlertAction[] = ["ack", "snooze", "read"];

export async function POST(req: Request) {
  // Same-origin only (the service worker): a cross-site form can't post here.
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin && origin !== `${req.headers.get("x-forwarded-proto") ?? "https"}://${req.headers.get("host")}`) {
    return NextResponse.json({ error: "cross-origin request" }, { status: 403 });
  }
  if (!(req.headers.get("content-type") ?? "").includes("application/json")) return NextResponse.json({ error: "send JSON" }, { status: 415 });
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: { id?: unknown; action?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const id = typeof body.id === "string" ? body.id : "";
  const action = ACTIONS.find((a) => a === body.action);
  if (!id || !action) return NextResponse.json({ error: "id and action (ack, snooze or read) are required" }, { status: 400 });
  const r = await alertAction(user, id, action);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  try {
    revalidatePath("/", "layout");
  } catch {
    // outside a request scope (tests)
  }
  return NextResponse.json({ ok: true });
}
