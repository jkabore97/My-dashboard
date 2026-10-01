// Schema migrations, applied automatically (in order, once each) the first
// time the app talks to the database. Never edit a shipped migration; add a
// new one at the end.
export const MIGRATIONS: { version: number; name: string; sql: string }[] = [
  {
    version: 1,
    name: "init",
    sql: `
create table tasks (
  id uuid primary key default gen_random_uuid(),
  origin text not null check (origin in ('derived', 'manual', 'event')),
  source_key text unique,
  title text not null,
  detail text,
  severity text not null check (severity in ('critical', 'high', 'medium', 'low')),
  source text not null,
  url text,
  business text,
  business_override text,
  status text not null default 'open' check (status in ('open', 'snoozed', 'done')),
  snoozed_until timestamptz,
  resolved_by text check (resolved_by in ('user', 'auto')),
  resolved_at timestamptz,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tasks_status_idx on tasks (status, severity);

create table events (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique,
  source text not null,
  kind text not null,
  title text not null,
  body text,
  severity text not null check (severity in ('critical', 'high', 'medium', 'low')),
  url text,
  business text,
  occurred_at timestamptz not null default now(),
  received_at timestamptz not null default now(),
  payload jsonb
);
create index events_occurred_idx on events (occurred_at desc);

create table snapshots (
  id bigserial primary key,
  kind text not null,
  key text not null,
  data jsonb not null,
  taken_at timestamptz not null default now()
);
create index snapshots_lookup_idx on snapshots (kind, key, taken_at desc);

create table connections (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  account text not null,
  label text,
  business text,
  secret text not null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, account)
);

create table settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table users (
  email text primary key,
  totp_secret text,
  totp_pending_secret text,
  totp_enabled_at timestamptz,
  totp_last_step bigint,
  recovery_codes jsonb not null default '[]'::jsonb,
  session_version integer not null default 1,
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);

create table audit_log (
  id bigserial primary key,
  actor text not null,
  action text not null,
  target text,
  detail jsonb,
  ip text,
  at timestamptz not null default now()
);
create index audit_log_at_idx on audit_log (at desc);

create table rate_limits (
  key text primary key,
  count integer not null,
  window_start timestamptz not null
);

-- The dashboard connects as the table owner / service role. Enabling RLS with
-- no policies means Supabase's public anon key can never read these tables.
alter table tasks enable row level security;
alter table events enable row level security;
alter table snapshots enable row level security;
alter table connections enable row level security;
alter table settings enable row level security;
alter table users enable row level security;
alter table audit_log enable row level security;
alter table rate_limits enable row level security;
`,
  },
  {
    version: 2,
    name: "rls_schema_migrations",
    // Created by migrate() itself, so it missed the RLS above.
    sql: "alter table schema_migrations enable row level security;",
  },
];
