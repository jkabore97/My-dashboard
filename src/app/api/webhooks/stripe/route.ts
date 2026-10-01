import { handleStripe } from "@/lib/server/webhook-handlers";
import { receiveWebhook } from "@/lib/server/webhook-route";
import { verifyStripe } from "@/lib/server/webhooks";

export async function POST(req: Request) {
  return receiveWebhook(
    req,
    "stripe",
    (secret, raw) => verifyStripe(secret, raw, req.headers.get("stripe-signature")),
    (_raw, p) => handleStripe(p),
  );
}
