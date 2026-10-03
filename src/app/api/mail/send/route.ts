import { NextResponse } from "next/server";
import { clientIp, currentUser } from "@/lib/server/auth";
import { canSee } from "@/lib/access";
import { parseSendForm, sameOrigin } from "@/lib/mail/compose";
import { sendMail } from "@/lib/server/mail";
import { MAX_TOTAL_ATTACHMENT_BYTES } from "@/lib/mail/limits";

// Sends a new message, reply, reply-all or forward (multipart form from the
// composer). Who may send from which mailbox is decided in sendMail; each
// send is audited there.

export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ ok: false, error: "Cross-site request refused." }, { status: 403 });
  const user = await currentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Sign in again." }, { status: 401 });
  if (!canSee(user, "inbox")) return NextResponse.json({ ok: false, error: "Your access doesn't include the Inbox." }, { status: 403 });
  if (Number(req.headers.get("content-length") ?? 0) > MAX_TOTAL_ATTACHMENT_BYTES + 512 * 1024) return NextResponse.json({ ok: false, error: "The message is too large." }, { status: 413 });
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "The message couldn't be read." }, { status: 400 });
  }
  const parsed = await parseSendForm(form);
  if ("error" in parsed) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  const result = await sendMail(user, parsed.mailbox, parsed.req, await clientIp());
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
