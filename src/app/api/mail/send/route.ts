import { NextResponse } from "next/server";
import { clientIp, currentUser } from "@/lib/server/auth";
import { canSee } from "@/lib/access";
import { parseSendForm, readCappedForm, sameOrigin } from "@/lib/mail/compose";
import { sendMail } from "@/lib/server/mail";

// Sends a new message, reply, reply-all or forward (multipart form from the
// composer). Who may send from which mailbox is decided in sendMail; each
// send is audited there.

export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ ok: false, error: "Cross-site request refused." }, { status: 403 });
  const user = await currentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Sign in again." }, { status: 401 });
  if (!canSee(user, "inbox")) return NextResponse.json({ ok: false, error: "Your access doesn't include the Inbox." }, { status: 403 });
  const read = await readCappedForm(req);
  if ("error" in read) return NextResponse.json({ ok: false, error: read.error }, { status: read.status });
  const parsed = await parseSendForm(read.form);
  if ("error" in parsed) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  const result = await sendMail(user, parsed.mailbox, parsed.req, await clientIp());
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
