import { getDb } from "../db";

// A small built-in CRM: clients and the deals you're working with them.

export type DealStage = "lead" | "proposal" | "negotiation" | "won" | "lost";
export const OPEN_STAGES: DealStage[] = ["lead", "proposal", "negotiation"];
export const STAGES: DealStage[] = ["lead", "proposal", "negotiation", "won", "lost"];

export interface Client {
  id: string;
  business: string | null;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  notes: string | null;
  archived: boolean;
}

export interface Deal {
  id: string;
  clientId: string | null;
  clientName: string | null;
  business: string | null;
  title: string;
  valueMinor: number | null;
  currency: string;
  stage: DealStage;
  expectedClose: string | null;
  nextStep: string | null;
  nextStepDue: string | null;
  closedOn: string | null;
  notes: string | null;
  /** YYYY-MM-DD of the last change, for "stalled" detection. */
  updatedOn: string;
}

const d = (col: string, as = col) => `to_char(${col}, 'YYYY-MM-DD') as ${as}`;

type ClientRow = { id: string; business: string | null; name: string; contact_name: string | null; email: string | null; phone: string | null; website: string | null; notes: string | null; archived: boolean };
const toClient = (r: ClientRow): Client => ({ id: r.id, business: r.business, name: r.name, contactName: r.contact_name, email: r.email, phone: r.phone, website: r.website, notes: r.notes, archived: r.archived });

export async function listClients(includeArchived = false) {
  const db = await getDb();
  const rows = await db.query<ClientRow>(`select id, business, name, contact_name, email, phone, website, notes, archived from clients ${includeArchived ? "" : "where not archived"} order by archived, name`);
  return rows.map(toClient);
}

export async function saveClient(c: Omit<Client, "id" | "archived"> & { id?: string }) {
  const db = await getDb();
  const params = [c.business, c.name, c.contactName, c.email, c.phone, c.website, c.notes];
  const cols = "id, business, name, contact_name, email, phone, website, notes, archived";
  const [row] = c.id
    ? await db.query<ClientRow>(`update clients set business = $1, name = $2, contact_name = $3, email = $4, phone = $5, website = $6, notes = $7, updated_at = now() where id = $8 returning ${cols}`, [...params, c.id])
    : await db.query<ClientRow>(`insert into clients (business, name, contact_name, email, phone, website, notes) values ($1, $2, $3, $4, $5, $6, $7) returning ${cols}`, params);
  return row ? toClient(row) : null;
}

export async function setClientArchived(id: string, archived: boolean) {
  const db = await getDb();
  const rows = await db.query<{ name: string }>("update clients set archived = $2, updated_at = now() where id = $1 returning name", [id, archived]);
  return rows[0] ?? null;
}

type DealRow = { id: string; client_id: string | null; client_name: string | null; business: string | null; title: string; value_minor: string | null; currency: string; stage: DealStage; expected_close: string | null; next_step: string | null; next_step_due: string | null; closed_on: string | null; notes: string | null; updated_on: string };
const toDeal = (r: DealRow): Deal => ({ id: r.id, clientId: r.client_id, clientName: r.client_name, business: r.business, title: r.title, valueMinor: r.value_minor == null ? null : Number(r.value_minor), currency: r.currency, stage: r.stage, expectedClose: r.expected_close, nextStep: r.next_step, nextStepDue: r.next_step_due, closedOn: r.closed_on, notes: r.notes, updatedOn: r.updated_on });

const DEAL_SELECT = `select d.id, d.client_id, c.name as client_name, d.business, d.title, d.value_minor::text as value_minor, d.currency, d.stage,
  ${d("d.expected_close", "expected_close")}, d.next_step, ${d("d.next_step_due", "next_step_due")}, ${d("d.closed_on", "closed_on")}, d.notes,
  to_char(d.updated_at at time zone 'UTC', 'YYYY-MM-DD') as updated_on
  from deals d left join clients c on c.id = d.client_id`;

/** Open deals plus deals closed on or after `closedSince`. */
export async function listDeals(closedSince: string) {
  const db = await getDb();
  const rows = await db.query<DealRow>(`${DEAL_SELECT} where d.stage in ('lead', 'proposal', 'negotiation') or d.closed_on >= $1::date order by d.next_step_due nulls last, d.created_at`, [closedSince]);
  return rows.map(toDeal);
}

export async function getDeal(id: string) {
  const db = await getDb();
  const [row] = await db.query<DealRow>(`${DEAL_SELECT} where d.id = $1`, [id]);
  return row ? toDeal(row) : null;
}

export async function saveDeal(x: Omit<Deal, "id" | "clientName" | "closedOn" | "updatedOn"> & { id?: string }, today: string) {
  const db = await getDb();
  const closed = x.stage === "won" || x.stage === "lost";
  const params = [x.clientId, x.business, x.title, x.valueMinor == null ? null : String(x.valueMinor), x.currency, x.stage, x.expectedClose, x.nextStep, x.nextStepDue, x.notes];
  const rows = x.id
    ? await db.query<{ id: string }>(
        `update deals set client_id = $1, business = $2, title = $3, value_minor = $4::text::bigint, currency = $5, stage = $6, expected_close = $7::date,
           next_step = $8, next_step_due = $9::date, notes = $10,
           closed_on = case when $6 in ('won', 'lost') then coalesce(case when stage in ('won', 'lost') then closed_on end, $12::date) else null end,
           updated_at = now() where id = $11 returning id`,
        [...params, x.id, today],
      )
    : await db.query<{ id: string }>(
        `insert into deals (client_id, business, title, value_minor, currency, stage, expected_close, next_step, next_step_due, notes, closed_on)
         values ($1, $2, $3, $4::text::bigint, $5, $6, $7::date, $8, $9::date, $10, $11::date) returning id`,
        [...params, closed ? today : null],
      );
  return rows[0] ? getDeal(rows[0].id) : null;
}

/** Moves a deal to another stage (board buttons), stamping closed_on for won/lost. */
export async function setDealStage(id: string, stage: DealStage, today: string) {
  const db = await getDb();
  const rows = await db.query<{ title: string }>(
    `update deals set stage = $2,
       closed_on = case when $2 in ('won', 'lost') then coalesce(case when stage in ('won', 'lost') then closed_on end, $3::date) else null end,
       updated_at = now() where id = $1 returning title`,
    [id, stage, today],
  );
  return rows[0] ?? null;
}

export async function deleteDeal(id: string) {
  const db = await getDb();
  const rows = await db.query<{ title: string }>("delete from deals where id = $1 returning title", [id]);
  return rows[0] ?? null;
}
