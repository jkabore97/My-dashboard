import { NextResponse } from "next/server";
import { currentUser } from "@/lib/server/auth";
import { canSee } from "@/lib/access";
import { fromKey } from "@/lib/mail/access";
import { getAttachment, MailAccessError, openMailbox } from "@/lib/server/mail";
import { MailApiError } from "@/lib/mail/outlook";
import { errorMessage } from "@/lib/source";
import { contentDisposition, safeContentType } from "@/lib/mail/download";

// Downloads one attachment of a message, for someone who may read that
// mailbox (checked on every request). Always served as a download, never
// rendered on the dashboard's origin, so an HTML or SVG attachment can't run.

export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!canSee(user, "inbox")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const url = new URL(req.url);
  const mailbox = url.searchParams.get("mb") ?? "";
  const messageId = fromKey(url.searchParams.get("m") ?? "");
  const attachmentId = fromKey(url.searchParams.get("a") ?? "");
  if (!messageId || !attachmentId) return NextResponse.json({ error: "Unknown attachment." }, { status: 400 });
  try {
    const o = await openMailbox(user, mailbox, "read");
    const a = await getAttachment(o, messageId, attachmentId);
    return new Response(a.body, {
      headers: {
        "Content-Type": safeContentType(a.contentType),
        "Content-Disposition": contentDisposition(a.name),
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox; default-src 'none'",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    if (err instanceof MailAccessError) return NextResponse.json({ error: err.message }, { status: 403 });
    if (err instanceof MailApiError) return NextResponse.json({ error: err.message }, { status: err.status === 404 ? 404 : 502 });
    return NextResponse.json({ error: `Couldn't download the attachment (${errorMessage(err)}).` }, { status: 502 });
  }
}
