import { NextResponse } from "next/server";
import { invalidateExternal } from "@/lib/aggregate";
import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/server/auth";
import { isFullOwner } from "@/lib/access";
import { auditConnection, isOAuthProvider, oauthConfigured, PROVIDER_NAMES } from "@/lib/server/connect";
import { appUrl, consumeOAuthState, getAuthed, postForm } from "@/lib/server/oauth";
import { saveConnection } from "@/lib/server/store/connections";
import { env } from "@/lib/source";
import { MS_SCOPES, msClient, msTenant } from "@/lib/server/microsoft";

export async function GET(req: Request, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  const url = new URL(req.url);
  const back = (q: string) => NextResponse.redirect(new URL(`/platforms?${q}`, req.url));
  const user = await currentUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));
  if (!isFullOwner(user)) return NextResponse.redirect(new URL("/?denied=1", req.url));
  if (!isOAuthProvider(provider) || !oauthConfigured(provider)) return back("error=Unknown+provider");
  if (!(await consumeOAuthState(`connect_${provider}`, url.searchParams.get("state")))) return back("error=Sign-in+expired+or+was+tampered+with.+Try+again.");
  const code = url.searchParams.get("code");
  if (!code) return back(`error=${encodeURIComponent(url.searchParams.get("error_description") ?? "Authorization was cancelled")}`);
  const redirectUri = `${appUrl(req)}/api/connect/${provider}/callback`;

  try {
    let account: string;
    let replaced: string[];
    if (provider === "github") {
      const t = await postForm<{ access_token: string }>("https://github.com/login/oauth/access_token", {
        client_id: env("GITHUB_OAUTH_CLIENT_ID")!,
        client_secret: env("GITHUB_OAUTH_CLIENT_SECRET")!,
        code,
        redirect_uri: redirectUri,
      });
      const me = await getAuthed<{ login: string }>("https://api.github.com/user", t.access_token);
      account = me.login;
      replaced = await saveConnection({ provider, account, label: me.login, secret: { token: t.access_token }, meta: { via: "oauth" } });
    } else if (provider === "gmail") {
      const t = await postForm<{ access_token: string; refresh_token?: string; scope?: string }>("https://oauth2.googleapis.com/token", {
        code,
        client_id: env("GOOGLE_CLIENT_ID")!,
        client_secret: env("GOOGLE_CLIENT_SECRET")!,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      });
      if (!t.refresh_token) return back("error=Google+did+not+return+offline+access.+Remove+the+app+at+myaccount.google.com/permissions+and+try+again.");
      const info = await getAuthed<{ email: string }>("https://openidconnect.googleapis.com/v1/userinfo", t.access_token);
      account = info.email.toLowerCase();
      // Remember what was granted: a user can untick Calendar or Analytics on Google's consent screen.
      replaced = await saveConnection({ provider, account, secret: { refreshToken: t.refresh_token }, meta: { via: "oauth", scopes: (t.scope ?? "").split(" ").filter(Boolean) } });
    } else if (provider === "microsoft") {
      const client = msClient()!;
      const t = await postForm<{ access_token: string; refresh_token?: string }>(`https://login.microsoftonline.com/${encodeURIComponent(msTenant())}/oauth2/v2.0/token`, {
        client_id: client.id,
        client_secret: client.secret,
        code,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
        scope: MS_SCOPES,
      });
      if (!t.refresh_token) return back("error=Microsoft+did+not+return+offline+access.+Try+again.");
      const me = await getAuthed<{ mail?: string | null; userPrincipalName: string }>("https://graph.microsoft.com/v1.0/me", t.access_token);
      account = (me.mail ?? me.userPrincipalName).toLowerCase();
      replaced = await saveConnection({ provider, account, secret: { refreshToken: t.refresh_token }, meta: { via: "oauth" } });
    } else {
      const t = await postForm<{ access_token: string; team_id?: string | null; user_id?: string; installation_id?: string }>(
        "https://api.vercel.com/v2/oauth/access_token",
        { client_id: env("VERCEL_CLIENT_ID")!, client_secret: env("VERCEL_CLIENT_SECRET")!, code, redirect_uri: redirectUri },
      );
      account = t.team_id ?? t.user_id ?? "vercel";
      replaced = await saveConnection({ provider, account, secret: { token: t.access_token, ...(t.team_id ? { teamId: t.team_id } : {}) }, meta: { via: "oauth", installationId: t.installation_id } });
    }
    await auditConnection(user.email, provider, account, "oauth", replaced);
    revalidatePath("/", "layout");
    await invalidateExternal();
    return back(`connected=${encodeURIComponent(PROVIDER_NAMES[provider])}`);
  } catch (err) {
    return back(`error=${encodeURIComponent(err instanceof Error ? err.message : "Connection failed")}`);
  }
}
