import { handleVercel } from "@/lib/server/webhook-handlers";
import { receiveWebhook } from "@/lib/server/webhook-route";
import { verifyVercel } from "@/lib/server/webhooks";

export async function POST(req: Request) {
  return receiveWebhook(
    req,
    "vercel",
    (secret, raw) => verifyVercel(secret, raw, req.headers.get("x-vercel-signature")),
    (_raw, p) => handleVercel(p),
  );
}
