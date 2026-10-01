import { handleGithub } from "@/lib/server/webhook-handlers";
import { receiveWebhook } from "@/lib/server/webhook-route";
import { verifyGithub } from "@/lib/server/webhooks";

export async function POST(req: Request) {
  const event = req.headers.get("x-github-event") ?? "unknown";
  const delivery = req.headers.get("x-github-delivery") ?? crypto.randomUUID();
  return receiveWebhook(
    req,
    "github",
    (secret, raw) => verifyGithub(secret, raw, req.headers.get("x-hub-signature-256")),
    (_raw, p) => handleGithub(event, delivery, p),
  );
}
