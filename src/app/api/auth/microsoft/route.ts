import { NextResponse } from "next/server";
import { microsoftSignInEnabled } from "@/lib/server/auth";
import { msTenant } from "@/lib/server/microsoft";
import { appUrl, createOAuthState } from "@/lib/server/oauth";

// Starts "Sign in with Microsoft". Only owners (ALLOWED_EMAILS) and invited
// team members get through; see the callback.
export async function GET(req: Request) {
  if (!microsoftSignInEnabled()) return NextResponse.redirect(new URL("/login?error=microsoft_disabled", req.url));
  const hint = new URL(req.url).searchParams.get("login_hint");
  const params = new URLSearchParams({
    client_id: process.env.MS_CLIENT_ID!.trim(),
    redirect_uri: `${appUrl(req)}/api/auth/microsoft/callback`,
    response_type: "code",
    response_mode: "query",
    scope: "openid profile",
    prompt: "select_account",
    state: await createOAuthState("signin_ms"),
    ...(hint && /^[^\s@]{1,64}@[^\s@]{1,190}$/.test(hint) ? { login_hint: hint } : {}),
  });
  return NextResponse.redirect(`https://login.microsoftonline.com/${encodeURIComponent(msTenant())}/oauth2/v2.0/authorize?${params}`);
}
