import { tick } from "../handler";

// Called every 5 minutes by a free external scheduler (cron-job.org): the
// scheduler link from Settings → Notifications. Syncs platforms, then alerts.
export const maxDuration = 60;

export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  return tick(req, (await ctx.params).token);
}

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  return tick(req, (await ctx.params).token);
}
