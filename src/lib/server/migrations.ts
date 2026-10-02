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
  {
    version: 3,
    name: "money_and_risk",
    sql: `
create table invoices (
  id uuid primary key default gen_random_uuid(),
  business text,
  client text not null,
  number text,
  amount_minor bigint not null check (amount_minor >= 0),
  currency text not null default 'usd',
  issued_on date,
  due_on date not null,
  status text not null default 'open' check (status in ('open', 'paid', 'void')),
  paid_on date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index invoices_status_idx on invoices (status, due_on);

create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  business text,
  vendor text not null,
  plan text,
  amount_minor bigint not null check (amount_minor >= 0),
  currency text not null default 'usd',
  billing_interval text not null check (billing_interval in ('month', 'year')),
  next_renewal date,
  auto_renew boolean not null default true,
  url text,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table deadlines (
  id uuid primary key default gen_random_uuid(),
  business text,
  title text not null,
  category text not null default 'other' check (category in ('tax', 'filing', 'license', 'insurance', 'contract', 'other')),
  due_on date not null,
  recurrence text not null default 'none' check (recurrence in ('none', 'monthly', 'quarterly', 'yearly')),
  remind_days integer not null default 14 check (remind_days between 0 and 365),
  notes text,
  url text,
  completed_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index deadlines_due_idx on deadlines (completed_on, due_on);

alter table invoices enable row level security;
alter table subscriptions enable row level security;
alter table deadlines enable row level security;
`,
  },
  {
    version: 4,
    name: "deadline_anchor_day",
    // Repeating deadlines step from this day so month ends don't drift.
    sql: `
alter table deadlines add column anchor_day smallint check (anchor_day between 1 and 31);
update deadlines set anchor_day = extract(day from due_on);
`,
  },
];
