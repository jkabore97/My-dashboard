import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, sessionToken } from "@/lib/auth";

export async function proxy(req: NextRequest) {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) {
    // Never serve business data publicly by accident.
    if (process.env.NODE_ENV === "production") {
      return new NextResponse("Set DASHBOARD_PASSWORD to enable this dashboard.", { status: 503 });
    }
    return NextResponse.next();
  }
  if (req.cookies.get(SESSION_COOKIE)?.value === (await sessionToken(password))) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!login|api/login|_next/static|_next/image|favicon.ico).*)"],
};
