import { NextResponse } from "next/server";
import { currentUser } from "@/lib/server/auth";
import { isFullOwner } from "@/lib/access";
import { authorizeUrl, isOAuthProvider, oauthConfigured } from "@/lib/server/connect";
import { appUrl, createOAuthState } from "@/lib/server/oauth";

export async function GET(req: Request, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  const user = await currentUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));
  if (!isFullOwner(user)) return NextResponse.redirect(new URL("/?denied=1", req.url));
  if (!isOAuthProvider(provider) || !oauthConfigured(provider)) {
    return NextResponse.redirect(new URL(`/platforms?error=${encodeURIComponent(`${provider} sign-in is not configured`)}`, req.url));
  }
  const redirectUri = `${appUrl(req)}/api/connect/${provider}/callback`;
  return NextResponse.redirect(authorizeUrl(provider, redirectUri, await createOAuthState(`connect_${provider}`)));
}
