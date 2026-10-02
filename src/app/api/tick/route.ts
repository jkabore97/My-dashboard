import { tick } from "./handler";

// Same as /api/tick/<token>, for schedulers that send "Authorization: Bearer $CRON_SECRET".
export const maxDuration = 60;

export async function GET(req: Request) {
  return tick(req, null);
}

export async function POST(req: Request) {
  return tick(req, null);
}
