import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, sessionSecret, verifySession } from "@/lib/session";

// First line of defence: every non-public route needs a validly signed, fully
// authenticated session. Pages and actions re-check against the database
// (revocation, allow-list) via requireUser().
const PUBLIC = [/^\/login(\/|$)/, /^\/api\/auth\//, /^\/api\/webhooks\//, /^\/api\/cron\//];

export async function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;
  if (PUBLIC.some((re) => re.test(path))) return NextResponse.next();

  const secret = sessionSecret();
  if (!secret) return new NextResponse("Set SESSION_SECRET (32+ random characters) to enable this dashboard.", { status: 503 });

  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value, secret);
  if (session?.stage === "full") return NextResponse.next();

  if (path.startsWith("/api/")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = session?.stage === "pending" ? "/login/2fa" : "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
