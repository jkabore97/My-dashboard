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
  {
    version: 5,
    name: "clients_and_deals",
    sql: `
create table clients (
  id uuid primary key default gen_random_uuid(),
  business text,
  name text not null,
  contact_name text,
  email text,
  phone text,
  website text,
  notes text,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table deals (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete set null,
  business text,
  title text not null,
  value_minor bigint check (value_minor >= 0),
  currency text not null default 'usd',
  stage text not null default 'lead' check (stage in ('lead', 'proposal', 'negotiation', 'won', 'lost')),
  expected_close date,
  next_step text,
  next_step_due date,
  closed_on date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index deals_stage_idx on deals (stage, next_step_due);

alter table clients enable row level security;
alter table deals enable row level security;
`,
  },
  {
    version: 6,
    name: "notifications_and_ai",
    sql: `
create table push_subscriptions (
  endpoint text primary key,
  owner text not null,
  keys jsonb not null,
  user_agent text,
  created_at timestamptz not null default now()
);

-- One row per task per channel once it has been pushed / emailed.
create table notified (
  task_id uuid not null references tasks(id) on delete cascade,
  channel text not null,
  at timestamptz not null default now(),
  primary key (task_id, channel)
);

-- AI triage results, keyed by message id; recomputed only when missing.
create table email_triage (
  message_id text primary key,
  severity text not null check (severity in ('critical', 'high', 'medium', 'low')),
  summary text not null,
  needs_reply boolean not null default false,
  task text,
  created_at timestamptz not null default now()
);

alter table push_subscriptions enable row level security;
alter table notified enable row level security;
alter table email_triage enable row level security;
`,
  },
  {
    version: 7,
    name: "notified_resets_on_status_change",
    // A task that resolves or reopens may be pushed again when it recurs.
    sql: `
create or replace function clear_task_notified() returns trigger
language plpgsql set search_path = public as $$
begin
  delete from notified where task_id = new.id;
  return new;
end $$;

create trigger tasks_clear_notified after update of status on tasks
for each row when (old.status is distinct from new.status) execute function clear_task_notified();
`,
  },
  {
    version: 8,
    name: "team_assignments_client_portals",
    sql: `
-- Team members. Owners from the environment (DASHBOARD_PASSWORD / ALLOWED_EMAILS)
-- have no role here and always get full access.
alter table users add column role text check (role in ('owner', 'developer', 'assistant', 'accountant'));
alter table users add column businesses jsonb;
alter table users add column name text;
alter table users add column password_hash text;
alter table users add column disabled_at timestamptz;
alter table users add column invited_by text;

create table invites (
  id uuid primary key default gen_random_uuid(),
  email text not null references users(email) on delete cascade,
  token_hash text not null unique,
  created_by text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);

alter table tasks add column assignee text references users(email) on delete set null;
create index tasks_assignee_idx on tasks (assignee) where assignee is not null;

create table task_activity (
  id bigserial primary key,
  task_id uuid not null references tasks(id) on delete cascade,
  actor text not null,
  action text not null,
  detail jsonb,
  at timestamptz not null default now()
);
create index task_activity_task_idx on task_activity (task_id, at desc);
create index task_activity_at_idx on task_activity (at desc);

-- Read-only status pages shared with a client. Only the token's hash is kept.
create table client_portals (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  token_hash text not null unique,
  sites jsonb not null default '[]'::jsonb,
  show_projects boolean not null default true,
  created_by text not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  last_viewed_at timestamptz
);

alter table invites enable row level security;
alter table task_activity enable row level security;
alter table client_portals enable row level security;
`,
  },
];

