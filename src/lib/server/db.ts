import { MIGRATIONS } from "./migrations";

export type Row = Record<string, unknown>;

export interface Db {
  query<T = Row>(text: string, params?: unknown[]): Promise<T[]>;
  /** Runs several statements at once (no parameters). */
  exec(text: string): Promise<void>;
  tx<T>(fn: (db: Db) => Promise<T>): Promise<T>;
}

const MIGRATION_LOCK = 727274;

let dbPromise: Promise<Db> | null = null;

export function isProduction() {
  return process.env.NODE_ENV === "production";
}

// Production needs a real Postgres (Supabase, Neon…) via DATABASE_URL.
// Locally, an embedded Postgres (PGlite) under .data/ is used so the app
// works with zero setup.
export function getDb(): Promise<Db> {
  if (!dbPromise) {
    dbPromise = connect().catch((err) => {
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

/** Test hook: replace the database (e.g. an in-memory PGlite). */
export async function useDb(db: Db) {
  await migrate(db);
  dbPromise = Promise.resolve(db);
}

async function connect(): Promise<Db> {
  const url = process.env.DATABASE_URL?.trim();
  let db: Db;
  if (url) db = await postgresDb(url);
  else if (isProduction()) throw new Error("DATABASE_URL is not set. Phase 1 features need a Postgres database in production.");
  else db = await pgliteDb(process.env.PGLITE_DIR ?? ".data/pglite");
  await migrate(db);
  return db;
}

export async function postgresDb(url: string): Promise<Db> {
  const postgres = (await import("postgres")).default;
  // prepare:false keeps this compatible with Supabase's transaction pooler.
  const sql = postgres(url, { prepare: false, max: 5, idle_timeout: 20, onnotice: () => {} });
  // Sql and TransactionSql share the `unsafe` API used here.
  type Runner = { unsafe: (text: string, params?: never[]) => Promise<unknown> & { simple(): Promise<unknown> } };
  const wrap = (s: Runner, root: boolean): Db => ({
    query: async <T,>(text: string, params: unknown[] = []) => (await s.unsafe(text, params as never[])) as T[],
    exec: async (text: string) => {
      await s.unsafe(text).simple();
    },
    // Nested tx() calls reuse the open transaction.
    tx: (fn) => (root ? (sql.begin((t) => fn(wrap(t as unknown as Runner, false))) as Promise<never>) : fn(wrap(s, false))),
  });
  return wrap(sql as unknown as Runner, true);
}

export async function pgliteDb(dataDir?: string): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = dataDir ? new PGlite(dataDir) : new PGlite();
  await pg.waitReady;
  type Tx = Parameters<Parameters<typeof pg.transaction>[0]>[0];
  const wrap = (s: typeof pg | Tx, root: boolean): Db => ({
    query: async <T,>(text: string, params: unknown[] = []) => (await s.query<T>(text, params)).rows,
    exec: async (text: string) => {
      await s.exec(text);
    },
    tx: (fn) => (root ? pg.transaction((t) => fn(wrap(t, false))) : fn(wrap(s, false))),
  });
  return wrap(pg, true);
}

async function migrate(db: Db) {
  await db.exec(`
    create table if not exists schema_migrations (
      version integer primary key,
      name text not null,
      applied_at timestamptz not null default now()
    );
  `);
  const pending = async () => {
    const done = await db.query<{ version: number }>("select version from schema_migrations");
    const applied = new Set(done.map((r) => Number(r.version)));
    return MIGRATIONS.filter((m) => !applied.has(m.version));
  };
  if ((await pending()).length === 0) return;
  // Serialize concurrent cold starts with an advisory lock held by the transaction.
  await db.tx(async (tx) => {
    await tx.query("select pg_advisory_xact_lock($1)", [MIGRATION_LOCK]);
    const done = await tx.query<{ version: number }>("select version from schema_migrations");
    const applied = new Set(done.map((r) => Number(r.version)));
    for (const m of MIGRATIONS) {
      if (applied.has(m.version)) continue;
      await tx.exec(m.sql);
      await tx.query("insert into schema_migrations (version, name) values ($1, $2)", [m.version, m.name]);
    }
  });
}
