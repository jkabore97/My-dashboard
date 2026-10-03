import { NextResponse } from "next/server";
import { invalidateExternal } from "@/lib/aggregate";
import { revalidatePath } from "next/cache";
import { currentUser, type CurrentUser } from "@/lib/server/auth";
import { canConnectPersonal, isFullOwner } from "@/lib/access";
import { auditConnection, isOAuthProvider, isPersonalProvider, oauthConfigured, PROVIDER_NAMES } from "@/lib/server/connect";
import { appUrl, consumeOAuthState, consumeOAuthStateIfMatches, createOAuthState, getAuthed, postForm } from "@/lib/server/oauth";
import { AccountTaken, listConnections, saveConnection } from "@/lib/server/store/connections";
import { getUser } from "@/lib/server/store/users";
import { env } from "@/lib/source";
import { MS_SCOPES, msClient, msTenant } from "@/lib/server/microsoft";
import { decodeJwtPayload, msIdentity, ownMicrosoftAccount } from "@/lib/server/ms-identity";
import { ARM_SCOPE, GRAPH_ADMIN_SCOPES, msAdminAuthorizeUrl, msTokenUrl, redeemRefreshToken } from "@/lib/server/msadmin";
import { armTokenMessage } from "@/lib/billing/microsoft";

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: Request, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  const url = new URL(req.url);
  const user = await currentUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));
  const state = url.searchParams.get("state");
  // Someone connecting their own mailbox, or an owner connecting a shared platform.
  const mine = isPersonalProvider(provider) && (await consumeOAuthStateIfMatches(`mine_${provider}`, state));
  const back = (q: string) => NextResponse.redirect(new URL(mine ? `/settings?${q}#my-mail` : `/platforms?${q}`, req.url));
  if (mine ? !canConnectPersonal(user) : !isFullOwner(user)) return NextResponse.redirect(new URL("/?denied=1", req.url));
  if (!isOAuthProvider(provider) || !oauthConfigured(provider)) return back("error=Unknown+provider");
  // Microsoft 365 admin, second step: consent for Azure billing (only when the first sign-in couldn't include it).
  if (provider === "msadmin" && (await consumeOAuthStateIfMatches("connect_msadmin_arm", state))) {
    try {
      return await msAdminBillingStep(url, `${appUrl(req)}/api/connect/msadmin/callback`, user, back);
    } catch (err) {
      return back(`error=${encodeURIComponent(err instanceof Error ? err.message : "Connection failed")}`);
    }
  }
  if (!mine && !(await consumeOAuthState(`connect_${provider}`, state))) return back("error=Sign-in+expired+or+was+tampered+with.+Try+again.");
  const code = url.searchParams.get("code");
  if (!code) return back(`error=${encodeURIComponent(url.searchParams.get("error_description") ?? "Authorization was cancelled")}`);
  const redirectUri = `${appUrl(req)}/api/connect/${provider}/callback`;

  try {
    if (mine) return await connectPersonal(provider as "microsoft" | "gmail", code, redirectUri, user, back);
    let account: string;
    let replaced: string[];
    if (provider === "msadmin") {
      const r = await connectMsAdmin(code, redirectUri);
      if ("error" in r) return back(`error=${encodeURIComponent(r.error)}`);
      await auditConnection(user.email, provider, r.account, "oauth", r.replaced);
      revalidatePath("/", "layout");
      await invalidateExternal();
      // Billing wasn't consented with the first sign-in: ask for it now, automatically.
      if (r.armConsent) {
        const next = await createOAuthState("connect_msadmin_arm");
        return NextResponse.redirect(msAdminAuthorizeUrl(redirectUri, next, "arm", r.account));
      }
      return back(`connected=${encodeURIComponent(`Microsoft 365 admin (${r.account})${r.armNote ? `. Billing isn't readable yet: ${r.armNote}` : ""}`)}`);
    } else if (provider === "github") {
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

/**
 * A person's own mailbox and calendar. Stored with owner_email = them, and
 * only if the account is theirs: for Microsoft, the account they sign in with
 * (or, if they don't use Microsoft sign-in, the one named like their address);
 * for Google, a verified address equal to theirs. Which account it was is recorded.
 */
async function connectPersonal(provider: "microsoft" | "gmail", code: string, redirectUri: string, user: CurrentUser, back: (q: string) => NextResponse) {
  let account: string;
  let meta: Record<string, unknown>;
  let secret: { refreshToken: string };
  if (provider === "microsoft") {
    const client = msClient()!;
    const t = await postForm<{ access_token: string; refresh_token?: string; id_token?: string }>(`https://login.microsoftonline.com/${encodeURIComponent(msTenant())}/oauth2/v2.0/token`, {
      client_id: client.id,
      client_secret: client.secret,
      code,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      scope: `openid profile ${MS_SCOPES}`,
    });
    if (!t.refresh_token) return back("error=Microsoft+did+not+return+offline+access.+Try+again.");
    // The ID token comes straight from Microsoft's token endpoint over TLS, in exchange for our secret.
    const claims = t.id_token ? decodeJwtPayload(t.id_token) : null;
    const row = await getUser(user.email);
    const tenant = msTenant();
    const own = claims ? ownMicrosoftAccount(claims, { email: user.email, msSubject: row?.ms_subject ?? null }, { tenant, expectedTid: GUID.test(tenant) ? tenant.toLowerCase() : null }) : { error: "Microsoft didn't say which account signed in. Try again." };
    if ("error" in own) return back(`error=${encodeURIComponent(own.error)}`);
    const me = await getAuthed<{ mail?: string | null; userPrincipalName: string }>("https://graph.microsoft.com/v1.0/me", t.access_token);
    account = (me.mail ?? me.userPrincipalName).toLowerCase();
    secret = { refreshToken: t.refresh_token };
    meta = { via: "oauth", personal: true, msSubject: own.subject, msAccount: own.email };
  } else {
    const t = await postForm<{ access_token: string; refresh_token?: string; scope?: string }>("https://oauth2.googleapis.com/token", {
      code,
      client_id: env("GOOGLE_CLIENT_ID")!,
      client_secret: env("GOOGLE_CLIENT_SECRET")!,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    });
    if (!t.refresh_token) return back("error=Google+did+not+return+offline+access.+Remove+the+app+at+myaccount.google.com/permissions+and+try+again.");
    const info = await getAuthed<{ email: string; email_verified?: boolean; sub?: string }>("https://openidconnect.googleapis.com/v1/userinfo", t.access_token);
    account = info.email.toLowerCase();
    if (info.email_verified === false || account !== user.email.toLowerCase()) {
      return back(`error=${encodeURIComponent(`Connect your own Google account (${user.email}), not ${account}.`)}`);
    }
    secret = { refreshToken: t.refresh_token };
    meta = { via: "oauth", personal: true, googleSubject: info.sub ?? null, scopes: (t.scope ?? "").split(" ").filter(Boolean) };
  }
  try {
    await saveConnection({ provider, account, secret, meta, ownerEmail: user.email });
  } catch (err) {
    if (err instanceof AccountTaken) return back(`error=${encodeURIComponent(err.message)}`);
    throw err;
  }
  await auditConnection(user.email, provider, `${account} (personal)`, "oauth", []);
  revalidatePath("/", "layout");
  await invalidateExternal();
  return back(`connected=${encodeURIComponent(`your ${PROVIDER_NAMES[provider]} mailbox`)}`);
}

const msClaimsIdentity = (idToken: string | undefined) => {
  const claims = idToken ? decodeJwtPayload(idToken) : null;
  const tenant = msTenant();
  return claims ? msIdentity(claims, { tenant, expectedTid: GUID.test(tenant) ? tenant.toLowerCase() : null }) : { error: "Microsoft didn't say which account signed in. Try again." };
};

/**
 * Microsoft 365 admin, first step: redeem the code for Graph (licences,
 * service health), then the same refresh token for Azure Resource Manager
 * (billing). Saved as the one owner-only "msadmin" connection.
 */
async function connectMsAdmin(code: string, redirectUri: string): Promise<{ error: string } | { account: string; replaced: string[]; armConsent: boolean; armNote: string | null }> {
  const client = msClient()!;
  const t = await postForm<{ access_token: string; refresh_token?: string; id_token?: string }>(msTokenUrl(), {
    client_id: client.id,
    client_secret: client.secret,
    code,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
    scope: `openid profile offline_access ${GRAPH_ADMIN_SCOPES}`,
  });
  if (!t.refresh_token) return { error: "Microsoft did not return offline access. Try again." };
  const id = msClaimsIdentity(t.id_token);
  if ("error" in id) return id;
  let refreshToken = t.refresh_token;
  let arm: string;
  try {
    const a = await redeemRefreshToken(refreshToken, "arm");
    if (a.refreshToken) refreshToken = a.refreshToken;
    arm = "ok";
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    arm = /AADSTS65001|consent_required|interaction_required/i.test(msg) ? "consent" : armTokenMessage(msg);
  }
  const replaced = await saveConnection({ provider: "msadmin", account: id.email, label: id.name ?? id.email, secret: { refreshToken }, meta: { via: "oauth", msSubject: id.subject, arm: arm === "ok" || arm === "consent" ? arm : "error" } });
  return { account: id.email, replaced, armConsent: arm === "consent", armNote: arm === "ok" || arm === "consent" ? null : arm };
}

/** Second step: the admin consented to Azure Service Management; keep the newer refresh token. */
async function msAdminBillingStep(url: URL, redirectUri: string, user: CurrentUser, back: (q: string) => NextResponse) {
  const code = url.searchParams.get("code");
  if (!code) {
    const why = (url.searchParams.get("error_description") ?? "cancelled").split(/\r?\n/)[0].slice(0, 200);
    return back(`connected=${encodeURIComponent(`Microsoft 365 admin, without billing (${why}). Licences and service health work; see docs/CONNECT.md to grant Azure Service Management`)}`);
  }
  const client = msClient()!;
  const t = await postForm<{ access_token: string; refresh_token?: string; id_token?: string }>(msTokenUrl(), {
    client_id: client.id,
    client_secret: client.secret,
    code,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
    scope: `openid profile offline_access ${ARM_SCOPE}`,
  });
  if (!t.refresh_token) return back("error=Microsoft+did+not+return+offline+access.+Try+again.");
  const id = msClaimsIdentity(t.id_token);
  if ("error" in id) return back(`error=${encodeURIComponent(id.error)}`);
  const stored = (await listConnections<{ refreshToken: string }>("msadmin")).filter((c) => !c.ownerEmail).at(-1);
  if (!stored || stored.account !== id.email) return back(`error=${encodeURIComponent(`Approve billing with the same admin account${stored ? ` (${stored.account})` : ""}.`)}`);
  await saveConnection({ provider: "msadmin", account: stored.account, secret: { refreshToken: t.refresh_token }, meta: { ...stored.meta, arm: "ok" } });
  await auditConnection(user.email, "msadmin", `${stored.account} (billing)`, "oauth", []);
  revalidatePath("/", "layout");
  await invalidateExternal();
  return back(`connected=${encodeURIComponent("Microsoft 365 admin with billing")}`);
}
