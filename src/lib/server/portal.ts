import { CLIENT_STAGE, summarizeUptime, type UptimeSummary } from "../portal";
import { today } from "../dates";
import { getDb } from "./db";
import { portalByToken } from "./store/portals";
import { takeAttempt } from "./store/ratelimit";

/** More than this many views of one link a minute shows a "try again" page instead of querying. */
export const PORTAL_VIEWS_PER_MINUTE = 30;

// Data for the public client page. Everything comes from what the dashboard
// already stored (uptime snapshots, deals): a visitor never triggers calls
// to outside services, and nothing internal (amounts, notes, next steps) is read.

export interface ClientPage {
  client: string;
  business: string | null;
  sites: ({ domain: string } & UptimeSummary)[];
  projects: { title: string; stage: string; expectedClose: string | null; closedOn: string | null }[] | null;
}

export async function clientPage(token: string): Promise<ClientPage | "busy" | null> {
  const view = await portalByToken(token);
  if (!view) return null;
  if ((await takeAttempt(`portal:${view.portal.id}`, 60)) > PORTAL_VIEWS_PER_MINUTE) return "busy";
  const db = await getDb();
  const sites = await Promise.all(
    view.portal.sites.slice(0, 20).map(async (domain) => {
      const rows = await db.query<{ data: { status: string; responseMs: number | null }; taken_at: Date | string }>(
        "select data, taken_at from snapshots where kind = 'website' and key = $1 and taken_at > now() - interval '30 days' order by taken_at asc",
        [domain],
      );
      return { domain, ...summarizeUptime(rows.map((r) => ({ status: r.data.status, responseMs: r.data.responseMs, at: new Date(r.taken_at).toISOString() }))) };
    }),
  );
  let projects: ClientPage["projects"] = null;
  if (view.portal.showProjects) {
    const since = new Date(Date.parse(`${today()}T00:00:00Z`) - 90 * 86_400_000).toISOString().slice(0, 10);
    const rows = await db.query<{ title: string; stage: Exclude<keyof typeof CLIENT_STAGE, never> | "lost"; expected_close: string | null; closed_on: string | null }>(
      `select title, stage, to_char(expected_close, 'YYYY-MM-DD') as expected_close, to_char(closed_on, 'YYYY-MM-DD') as closed_on
       from deals where client_id = $1 and stage <> 'lost' and (stage <> 'won' or closed_on is null or closed_on >= $2::date)
       order by case stage when 'won' then 0 else 1 end, coalesce(expected_close, closed_on) nulls last`,
      [view.portal.clientId, since],
    );
    projects = rows.map((r) => ({ title: r.title, stage: CLIENT_STAGE[r.stage as keyof typeof CLIENT_STAGE] ?? r.stage, expectedClose: r.stage === "won" ? null : r.expected_close, closedOn: r.closed_on }));
  }
  return { client: view.client.name, business: view.client.business, sites, projects };
}
