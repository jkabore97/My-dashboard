import { handleSupabase } from "@/lib/server/webhook-handlers";
import { receiveWebhook } from "@/lib/server/webhook-route";
import { verifySharedSecret } from "@/lib/server/webhooks";

// Configure in Supabase → Database → Webhooks with an HTTP header
// "x-webhook-secret: <secret>". Add ?site=example.com to label the source.
export async function POST(req: Request) {
  const site = new URL(req.url).searchParams.get("site");
  const validSite = site && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(site) ? site.toLowerCase() : null;
  return receiveWebhook(
    req,
    "supabase",
    (secret) => verifySharedSecret(secret, req.headers.get("x-webhook-secret") ?? req.headers.get("authorization")),
    (raw, p) => handleSupabase(raw, p, validSite),
  );
}
