import { NextResponse } from "next/server";
import { clientIp } from "@/lib/server/auth";
import { audit } from "@/lib/server/store/audit";
import { refundAttempt, takeAttempt } from "@/lib/server/store/ratelimit";
import { checkIngestToken, ingestConfigured, storeReading } from "@/lib/server/solar-store";
import { requestSync } from "@/lib/server/sync";
import { parseReading } from "@/lib/solar";

// Readings pushed by Home Assistant, a script next to the inverter, or a
// cloud bridge. Body: one reading, or { readings: [...] } (up to 50).
// Auth: Authorization: Bearer <ingest token>.

const MAX_BODY = 100_000;

export async function POST(req: Request) {
  if (!(await ingestConfigured())) return NextResponse.json({ error: "Solar ingest isn't set up: generate a token in Settings or set SOLAR_INGEST_TOKEN" }, { status: 503 });
  const ip = await clientIp();
  // Only failed tokens count toward the limit (refunded on success).
  const key = `ingest:solar:${ip ?? "unknown"}`;
  const n = await takeAttempt(key, 15 * 60);
  if (n === 21) await audit("solar-ingest", "ingest.rate_limited", key, null, ip);
  if (n > 20) return NextResponse.json({ error: "too many failed attempts" }, { status: 429 });
  if (!(await checkIngestToken(req.headers.get("authorization")))) return NextResponse.json({ error: "invalid token" }, { status: 401 });
  await refundAttempt(key);

  const raw = await req.text();
  if (raw.length > MAX_BODY) return NextResponse.json({ error: "payload too large" }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const items = Array.isArray((body as { readings?: unknown })?.readings) ? (body as { readings: unknown[] }).readings : [body];
  if (items.length === 0 || items.length > 50) return NextResponse.json({ error: "send 1 to 50 readings" }, { status: 400 });

  const parsed = items.map((b) => parseReading(b));
  const bad = parsed.findIndex((p) => typeof p === "string");
  if (bad >= 0) return NextResponse.json({ error: `reading ${bad + 1}: ${parsed[bad]}` }, { status: 400 });

  let stored = 0;
  let alert = false;
  for (const r of parsed) {
    if (typeof r === "string") continue;
    if (await storeReading(r)) stored++;
    if (r.status === "fault" || r.alarms.length) alert = true;
  }
  // A fault should reach the to-do list (and push) on the next check, not in 5 minutes.
  if (alert) await requestSync();
  return NextResponse.json({ ok: true, stored, skipped: parsed.length - stored });
}
