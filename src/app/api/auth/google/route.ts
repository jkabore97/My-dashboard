import { NextResponse } from "next/server";
import { googleSignInEnabled } from "@/lib/server/auth";
import { appUrl, createOAuthState } from "@/lib/server/oauth";

// Starts "Sign in with Google". Only emails in ALLOWED_EMAILS get through.
export async function GET(req: Request) {
  if (!googleSignInEnabled()) return NextResponse.redirect(new URL("/login?error=google_disabled", req.url));
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!.trim(),
    redirect_uri: `${appUrl(req)}/api/auth/google/callback`,
    response_type: "code",
    scope: "openid email",
    prompt: "select_account",
    state: await createOAuthState("signin"),
  });
  return NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
}
