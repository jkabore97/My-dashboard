import { NextResponse } from "next/server";
import { currentUser } from "@/lib/server/auth";
import { canConnectPersonal, isFullOwner } from "@/lib/access";
import { authorizeUrl, isOAuthProvider, isPersonalProvider, oauthConfigured } from "@/lib/server/connect";
import { appUrl, createOAuthState } from "@/lib/server/oauth";

// ?mine=1: the signed-in person connects their own mailbox and calendar
// (anyone with Inbox or Agenda). Otherwise an owner connects a shared platform.
export async function GET(req: Request, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  const mine = new URL(req.url).searchParams.get("mine") === "1";
  const user = await currentUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));
  const back = mine ? "/settings" : "/platforms";
  if (mine ? !canConnectPersonal(user) : !isFullOwner(user)) return NextResponse.redirect(new URL("/?denied=1", req.url));
  if (!isOAuthProvider(provider) || !oauthConfigured(provider) || (mine && !isPersonalProvider(provider))) {
    return NextResponse.redirect(new URL(`${back}?error=${encodeURIComponent(`${provider} sign-in is not configured`)}${mine ? "#my-mail" : ""}`, req.url));
  }
  // The same callback serves both; the state cookie's name says which flow it is.
  const redirectUri = `${appUrl(req)}/api/connect/${provider}/callback`;
  const state = await createOAuthState(mine ? `mine_${provider}` : `connect_${provider}`);
  return NextResponse.redirect(authorizeUrl(provider, redirectUri, state, mine ? { email: user.email } : undefined));
}
