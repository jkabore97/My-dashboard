import { NextResponse } from "next/server";
import { SESSION_COOKIE, sessionToken } from "@/lib/auth";

export async function POST(req: Request) {
  const form = await req.formData();
  const password = process.env.DASHBOARD_PASSWORD;
  const ok = !!password && form.get("password") === password;
  const res = NextResponse.redirect(new URL(ok ? "/" : "/login?error=1", req.url), 303);
  if (ok) {
    res.cookies.set(SESSION_COOKIE, await sessionToken(password), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
  }
  return res;
}
