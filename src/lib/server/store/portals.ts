import { randomBytes } from "node:crypto";
import { sha256Hex } from "../crypto";
import { getDb } from "../db";

// Read-only client status pages. The link holds a random token; only its hash
// is stored, so a database leak doesn't hand out working links.

export interface Portal {
  id: string;
  clientId: string;
  sites: string[];
  showProjects: boolean;
  createdBy: string;
  createdAt: string;
  lastViewedAt: string | null;
}

interface Row {
  id: string;
  client_id: string;
  sites: string[];
  show_projects: boolean;
  created_by: string;
  created_at: Date | string;
  last_viewed_at: Date | string | null;
}

const toPortal = (r: Row): Portal => ({
  id: r.id,
  clientId: r.client_id,
  sites: Array.isArray(r.sites) ? r.sites : [],
  showProjects: r.show_projects,
  createdBy: r.created_by,
  createdAt: new Date(r.created_at).toISOString(),
  lastViewedAt: r.last_viewed_at ? new Date(r.last_viewed_at).toISOString() : null,
});

/** Creates a client's status page link. A client has one live link: making a new one retires the old. */
export async function createPortal(p: { clientId: string; sites: string[]; showProjects: boolean; by: string }): Promise<{ token: string; portal: Portal }> {
  const db = await getDb();
  const token = randomBytes(32).toString("base64url");
  const row = await db.tx(async (tx) => {
    await tx.query("update client_portals set revoked_at = now() where client_id = $1 and revoked_at is null", [p.clientId]);
    const [r] = await tx.query<Row>(
      "insert into client_portals (client_id, token_hash, sites, show_projects, created_by) values ($1, $2, $3::text::jsonb, $4, $5) returning *",
      [p.clientId, sha256Hex(token), JSON.stringify(p.sites), p.showProjects, p.by],
    );
    return r;
  });
  return { token, portal: toPortal(row) };
}

export async function listPortals(): Promise<Portal[]> {
  const db = await getDb();
  return (await db.query<Row>("select * from client_portals where revoked_at is null order by created_at desc")).map(toPortal);
}

export async function revokePortal(id: string): Promise<{ clientId: string } | null> {
  const db = await getDb();
  const [row] = await db.query<{ client_id: string }>("update client_portals set revoked_at = now() where id = $1 and revoked_at is null returning client_id", [id]);
  return row ? { clientId: row.client_id } : null;
}

export async function portalClientId(id: string): Promise<string | null> {
  const db = await getDb();
  const [row] = await db.query<{ client_id: string }>("select client_id from client_portals where id = $1", [id]);
  return row?.client_id ?? null;
}

export interface PortalView {
  portal: Portal;
  client: { name: string; business: string | null };
}

/** The live portal for a token, with its client. Archived clients' links stop working. */
export async function portalByToken(token: string): Promise<PortalView | null> {
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return null;
  const db = await getDb();
  const [row] = await db.query<Row & { name: string; business: string | null }>(
    `select p.*, c.name, c.business from client_portals p join clients c on c.id = p.client_id
     where p.token_hash = $1 and p.revoked_at is null and not c.archived`,
    [sha256Hex(token)],
  );
  if (!row) return null;
  // At most one write a minute per link.
  await db.query("update client_portals set last_viewed_at = now() where id = $1 and (last_viewed_at is null or last_viewed_at < now() - interval '1 minute')", [row.id]);
  return { portal: toPortal(row), client: { name: row.name, business: row.business } };
}
