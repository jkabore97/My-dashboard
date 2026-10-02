import { NextResponse } from "next/server";
import { clientIp, completeFirstFactor, isAllowed, microsoftSignInEnabled } from "@/lib/server/auth";
import { msTenant } from "@/lib/server/microsoft";
import { decodeJwtPayload, msIdentity } from "@/lib/server/ms-identity";
import { appUrl, consumeOAuthState, postForm } from "@/lib/server/oauth";
import { audit } from "@/lib/server/store/audit";
import { ensureUser, linkMicrosoft } from "@/lib/server/store/users";

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const fail = (code: string) => NextResponse.redirect(new URL(`/login?error=${code}`, req.url));
  if (!microsoftSignInEnabled()) return fail("microsoft_disabled");
  if (!(await consumeOAuthState("signin_ms", url.searchParams.get("state")))) return fail("state");
  const code = url.searchParams.get("code");
  if (!code) return fail("microsoft");

  try {
    // The ID token comes straight from Microsoft's token endpoint over TLS, in
    // exchange for our client secret, so its claims can be read directly.
    const token = await postForm<{ id_token?: string }>(`https://login.microsoftonline.com/${encodeURIComponent(msTenant())}/oauth2/v2.0/token`, {
      client_id: process.env.MS_CLIENT_ID!.trim(),
      client_secret: process.env.MS_CLIENT_SECRET!.trim(),
      code,
      redirect_uri: `${appUrl(req)}/api/auth/microsoft/callback`,
      grant_type: "authorization_code",
      scope: "openid profile",
    });
    const claims = token.id_token ? decodeJwtPayload(token.id_token) : null;
    const id = claims ? msIdentity(claims, { tenant: msTenant(), expectedTid: GUID.test(msTenant()) ? msTenant().toLowerCase() : null }) : { error: "no id token" };
    const ip = await clientIp();
    if ("error" in id) {
      await audit("unknown", "login.microsoft.denied", null, { reason: id.error }, ip);
      return fail("not_allowed");
    }
    if (!(await isAllowed(id.email))) {
      await audit(id.email, "login.microsoft.denied", null, { reason: "not invited" }, ip);
      return fail("not_allowed");
    }
    await ensureUser(id.email);
    if (!(await linkMicrosoft(id.email, id.subject))) {
      await audit(id.email, "login.microsoft.denied", null, { reason: "different Microsoft account" }, ip);
      return fail("ms_mismatch");
    }
    await audit(id.email, "login.microsoft.first_factor", null, null, ip);
    return NextResponse.redirect(new URL(await completeFirstFactor(id.email), req.url));
  } catch {
    return fail("microsoft");
  }
}
