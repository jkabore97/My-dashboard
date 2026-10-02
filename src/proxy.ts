import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, sessionSecret, verifySession } from "@/lib/session";

// First line of defence: every non-public route needs a validly signed, fully
// authenticated session. Revocation, allow-list and 2FA are checked against
// the database by requireUser() wherever data is read (getDashboard, pages,
// actions); the layout alone isn't enough because client-side navigation
// re-renders only the page segment. The database check isn't done here: the
// proxy is bundled separately and would open its own connection pool (or a
// second embedded PGlite on the same data directory in development).
const PUBLIC = [/^\/login(\/|$)/, /^\/api\/auth\//, /^\/api\/webhooks\//, /^\/api\/cron\//, /^\/api\/ingest\//, /^\/sw\.js$/, /^\/manifest\.webmanifest$/, /^\/icons\//];

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
