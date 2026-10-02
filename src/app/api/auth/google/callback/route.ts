import { NextResponse } from "next/server";
import { clientIp, completeFirstFactor, googleSignInEnabled, isAllowed } from "@/lib/server/auth";
import { appUrl, consumeOAuthState, getAuthed, postForm } from "@/lib/server/oauth";
import { audit } from "@/lib/server/store/audit";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const fail = (code: string) => NextResponse.redirect(new URL(`/login?error=${code}`, req.url));
  if (!googleSignInEnabled()) return fail("google_disabled");
  if (!(await consumeOAuthState("signin", url.searchParams.get("state")))) return fail("state");
  const code = url.searchParams.get("code");
  if (!code) return fail("google");

  try {
    const token = await postForm<{ access_token: string }>("https://oauth2.googleapis.com/token", {
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!.trim(),
      client_secret: process.env.GOOGLE_CLIENT_SECRET!.trim(),
      redirect_uri: `${appUrl(req)}/api/auth/google/callback`,
      grant_type: "authorization_code",
    });
    const info = await getAuthed<{ email?: string; email_verified?: boolean }>("https://openidconnect.googleapis.com/v1/userinfo", token.access_token);
    const email = info.email?.toLowerCase();
    const ip = await clientIp();
    if (!email || !info.email_verified || !(await isAllowed(email))) {
      await audit(email ?? "unknown", "login.google.denied", null, null, ip);
      return fail("not_allowed");
    }
    await audit(email, "login.google.first_factor", null, null, ip);
    return NextResponse.redirect(new URL(await completeFirstFactor(email, "google"), req.url));
  } catch {
    return fail("google");
  }
}
