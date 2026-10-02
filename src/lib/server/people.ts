import { inBusiness, type Access } from "../access";
import { accessFor, isEnvOwner } from "./auth";
import { getDb } from "./db";

export interface Person extends Access {
  email: string;
  name: string;
}

/** Everyone who can sign in: environment owners who have signed in, and active team members. */
export async function people(): Promise<Person[]> {
  const db = await getDb();
  const rows = await db.query<{ email: string; name: string | null; role: string | null; businesses: string[] | null; sections: string[] | null }>(
    "select email, name, role, businesses, sections from users where disabled_at is null order by coalesce(name, email)",
  );
  return rows.filter((r) => r.role || isEnvOwner(r.email)).map((r) => ({ email: r.email, name: r.name || r.email, ...accessFor(r) }));
}

/** People a task of this business can be assigned to: anyone who sees that business. */
export async function assignableFor(business: string | null | undefined): Promise<Person[]> {
  return (await people()).filter((p) => inBusiness(p, business));
}
