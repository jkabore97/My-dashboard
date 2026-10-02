import { getDb } from "../db";

const TABLES = ["invoices", "subscriptions", "deadlines", "clients", "deals"] as const;
export type OwnedTable = (typeof TABLES)[number];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The business a record belongs to: undefined when the record doesn't exist, null when it has none. */
export async function rowBusiness(table: OwnedTable, id: string): Promise<string | null | undefined> {
  if (!TABLES.includes(table) || !UUID.test(id)) return undefined;
  const db = await getDb();
  const [row] = await db.query<{ business: string | null }>(`select business from ${table} where id = $1`, [id]);
  return row ? row.business : undefined;
}
