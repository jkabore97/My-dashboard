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
  {
    version: 9,
    name: "microsoft_sign_in",
    // The Microsoft account (tenant:object id) a user signed in with first; later sign-ins must match.
    sql: `
alter table users add column ms_subject text unique;
`,
  },
  {
    version: 10,
    name: "alert_routing",
    sql: `
-- Per-person alert preferences (time zone, quiet hours, toggles, pause).
-- Environment owners get a users row when they first sign in, so this covers them too.
alter table users add column notify_prefs jsonb not null default '{}'::jsonb;

-- When a task last changed status (opened, reopened, snoozed, woke, closed),
-- so the alert router can tell a new problem from one that was already open.
alter table tasks add column status_changed_at timestamptz;
update tasks set status_changed_at = greatest(created_at, occurred_at, coalesce(resolved_at, created_at));
alter table tasks alter column status_changed_at set default now();
alter table tasks alter column status_changed_at set not null;
create or replace function touch_task_status_changed() returns trigger
language plpgsql set search_path = public as $$
begin
  new.status_changed_at := now();
  return new;
end $$;
create trigger tasks_status_changed before update of status on tasks
for each row when (old.status is distinct from new.status) execute function touch_task_status_changed();

-- One row per task: its current open period. A task alerts once per period;
-- when it closes and later reopens or recurs, period goes up and it may alert
-- again. Unlike "notified", nothing here is cleared by a trigger.
create table alert_incidents (
  task_id uuid primary key references tasks(id) on delete cascade,
  period integer not null default 1,
  state text not null default 'open' check (state in ('open', 'closed')),
  opened_at timestamptz not null default now(),
  -- Not routed before this (website checks wait for a second look; 'infinity' = pre-existing, never routed).
  route_after timestamptz not null default now(),
  -- Highest severity routed in this period (null = not routed yet).
  routed_severity text check (routed_severity in ('critical', 'high', 'medium', 'low')),
  closed_at timestamptz,
  updated_at timestamptz not null default now()
);
create index alert_incidents_open_idx on alert_incidents (state, route_after);

-- Delivery log: one row per recipient per message.
create table alert_log (
  id uuid primary key default gen_random_uuid(),
  user_email text not null,
  task_id uuid references tasks(id) on delete set null,
  period integer,
  kind text not null check (kind in ('alert', 'resolved', 'digest', 'test')),
  severity text not null check (severity in ('critical', 'high', 'medium', 'low')),
  title text not null,
  body text,
  url text,
  status text not null check (status in ('queued', 'sent', 'failed', 'suppressed', 'folded')),
  reason text,
  dedupe_key text not null,
  deliver_after timestamptz not null default now(),
  lease_until timestamptz,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  read_at timestamptz,
  acked_at timestamptz,
  unique (user_email, dedupe_key)
);
create index alert_log_user_idx on alert_log (user_email, created_at desc);
create index alert_log_due_idx on alert_log (deliver_after) where status = 'queued';
create index alert_log_task_idx on alert_log (task_id, user_email) where task_id is not null;
create index alert_log_sent_idx on alert_log (user_email, sent_at) where status = 'sent';
create index alert_log_created_idx on alert_log (created_at desc);

alter table alert_incidents enable row level security;
alter table alert_log enable row level security;
`,
  },
  {
    version: 11,
    name: "personal_access",
    sql: `
-- Sections picked for a person, replacing their role's (null = the role's own).
alter table users add column sections jsonb;

-- Personal connections: a member's (or owner's) own mailbox and calendar.
-- Null = shared, as before. Removing the person removes their connection.
alter table connections add column owner_email text references users(email) on delete cascade;
create index connections_owner_idx on connections (owner_email) where owner_email is not null;

-- Tasks and events from someone's own mailbox are theirs alone; they go
-- when the person is removed.
alter table tasks add column private_to text references users(email) on delete cascade;
create index tasks_private_idx on tasks (private_to) where private_to is not null;
alter table events add column private_to text references users(email) on delete cascade;
create index events_private_idx on events (private_to) where private_to is not null;

-- Claude's reading of a personal message is that person's too.
alter table email_triage add column private_to text references users(email) on delete cascade;
create index email_triage_private_idx on email_triage (private_to) where private_to is not null;

-- Delivery-log rows about personal items, kept out of the owner's view of everyone's log.
alter table alert_log add column private boolean not null default false;
`,
  },
  {
    version: 12,
    name: "passkeys",
    sql: `
-- Random WebAuthn user handle (sent to authenticators instead of the email).
alter table users add column webauthn_id text unique;

-- Passkeys (WebAuthn credentials). Registered from Settings after a full
-- sign-in with 2FA; a passkey then signs its owner in without the code.
create table passkeys (
  id text primary key,                 -- credential id, base64url
  user_email text not null references users(email) on delete cascade,
  public_key text not null,            -- COSE public key, base64url
  counter bigint not null default 0,   -- signature counter (clone detection)
  transports jsonb not null default '[]'::jsonb,
  name text not null,
  device_type text not null default 'singleDevice' check (device_type in ('singleDevice', 'multiDevice')),
  backed_up boolean not null default false,
  aaguid text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index passkeys_user_idx on passkeys (user_email);

-- Single-use WebAuthn challenges, bound to one browser (an httpOnly cookie
-- holds the handle; only its hash is stored), one flow and, except for
-- sign-in, one user.
create table webauthn_challenges (
  handle_hash text primary key,
  flow text not null check (flow in ('register', 'login', 'second_factor', 'reauth')),
  challenge text not null,
  user_email text references users(email) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index webauthn_challenges_expiry_idx on webauthn_challenges (expires_at);

alter table passkeys enable row level security;
alter table webauthn_challenges enable row level security;
`,
  },
];
