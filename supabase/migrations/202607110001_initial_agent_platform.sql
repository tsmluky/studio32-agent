-- Studio32 Agent Platform · Phase 1
-- Multi-tenant persistence, human control and dashboard-ready read model.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text not null,
  status text not null default 'draft' check (status in ('draft', 'active', 'paused', 'archived')),
  timezone text not null default 'Europe/Madrid',
  locale text not null default 'es-ES',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'operator' check (role in ('owner', 'admin', 'operator', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table public.channel_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null check (provider in ('web', 'whatsapp_meta', 'whatsapp_twilio', 'voice', 'other')),
  external_account_id text not null,
  display_address text,
  status text not null default 'active' check (status in ('active', 'paused', 'disconnected')),
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, external_account_id)
);

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  phone text,
  email text,
  name text,
  status text not null default 'lead' check (status in ('lead', 'customer', 'blocked', 'archived')),
  source text,
  attributes jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index contacts_org_phone_unique
  on public.contacts (organization_id, phone) where phone is not null;
create unique index contacts_org_email_unique
  on public.contacts (organization_id, lower(email)) where email is not null;

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  channel_account_id uuid references public.channel_accounts(id) on delete set null,
  contact_id uuid not null references public.contacts(id) on delete restrict,
  external_thread_id text,
  status text not null default 'open' check (status in ('open', 'waiting', 'resolved', 'archived')),
  control_mode text not null default 'agent' check (control_mode in ('agent', 'human', 'paused')),
  assigned_user_id uuid references public.profiles(id) on delete set null,
  subject text,
  last_message_at timestamptz,
  agent_paused_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index conversations_external_thread_unique
  on public.conversations (organization_id, channel_account_id, external_thread_id)
  where external_thread_id is not null;
create index conversations_inbox_idx
  on public.conversations (organization_id, status, control_mode, last_message_at desc);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  provider_message_id text,
  direction text not null check (direction in ('inbound', 'outbound', 'internal')),
  sender_type text not null check (sender_type in ('contact', 'agent', 'human', 'system', 'tool')),
  sender_user_id uuid references public.profiles(id) on delete set null,
  content_type text not null default 'text' check (content_type in ('text', 'image', 'audio', 'document', 'location', 'event')),
  body text,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'accepted' check (status in ('accepted', 'queued', 'sent', 'delivered', 'read', 'failed')),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index messages_provider_id_unique
  on public.messages (organization_id, provider_message_id)
  where provider_message_id is not null;
create index messages_timeline_idx
  on public.messages (conversation_id, occurred_at, id);

create table public.services (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  external_key text,
  name text not null,
  description text,
  duration_minutes integer check (duration_minutes is null or duration_minutes > 0),
  price_amount numeric(12,2) check (price_amount is null or price_amount >= 0),
  currency text not null default 'EUR',
  active boolean not null default true,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, external_key)
);

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete restrict,
  conversation_id uuid references public.conversations(id) on delete set null,
  service_id uuid references public.services(id) on delete set null,
  external_calendar_event_id text,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'cancelled', 'completed', 'no_show')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  party_size integer check (party_size is null or party_size > 0),
  resource_name text,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create unique index appointments_calendar_event_unique
  on public.appointments (organization_id, external_calendar_event_id)
  where external_calendar_event_id is not null;
create index appointments_schedule_idx
  on public.appointments (organization_id, starts_at, status);

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  status text not null default 'new' check (status in ('new', 'qualified', 'contacted', 'won', 'lost', 'archived')),
  need text,
  preferred_contact_method text,
  city text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.agent_configs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  version integer not null,
  status text not null default 'draft' check (status in ('draft', 'active', 'retired')),
  business jsonb not null default '{}'::jsonb,
  services_snapshot jsonb not null default '[]'::jsonb,
  faq text,
  policies text,
  tone text,
  handoff_config jsonb not null default '{}'::jsonb,
  activated_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, version)
);

create unique index agent_configs_one_active_per_org
  on public.agent_configs (organization_id) where status = 'active';

create table public.handoffs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  requested_by text not null default 'agent' check (requested_by in ('contact', 'agent', 'human', 'system')),
  reason text not null,
  summary text,
  status text not null default 'open' check (status in ('open', 'accepted', 'resolved', 'cancelled')),
  assigned_user_id uuid references public.profiles(id) on delete set null,
  opened_at timestamptz not null default now(),
  accepted_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index handoffs_queue_idx
  on public.handoffs (organization_id, status, opened_at desc);

create table public.integrations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null,
  status text not null default 'pending' check (status in ('pending', 'active', 'error', 'disabled')),
  external_account_id text,
  config jsonb not null default '{}'::jsonb,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, provider)
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  organization_id uuid references public.organizations(id) on delete set null,
  actor_user_id uuid references public.profiles(id) on delete set null,
  actor_type text not null default 'system' check (actor_type in ('user', 'agent', 'system', 'integration')),
  action text not null,
  entity_type text,
  entity_id text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_logs_org_time_idx
  on public.audit_logs (organization_id, created_at desc);

create or replace function public.is_organization_member(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = target_organization_id
      and m.user_id = auth.uid()
  );
$$;

create or replace function public.has_organization_role(target_organization_id uuid, allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = target_organization_id
      and m.user_id = auth.uid()
      and m.role = any(allowed_roles)
  );
$$;

revoke all on function public.is_organization_member(uuid) from public;
revoke all on function public.has_organization_role(uuid, text[]) from public;
grant execute on function public.is_organization_member(uuid) to authenticated;
grant execute on function public.has_organization_role(uuid, text[]) to authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (new.id, new.raw_user_meta_data ->> 'name', new.raw_user_meta_data ->> 'avatar_url')
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create trigger organizations_updated_at before update on public.organizations for each row execute procedure public.set_updated_at();
create trigger profiles_updated_at before update on public.profiles for each row execute procedure public.set_updated_at();
create trigger channel_accounts_updated_at before update on public.channel_accounts for each row execute procedure public.set_updated_at();
create trigger contacts_updated_at before update on public.contacts for each row execute procedure public.set_updated_at();
create trigger conversations_updated_at before update on public.conversations for each row execute procedure public.set_updated_at();
create trigger services_updated_at before update on public.services for each row execute procedure public.set_updated_at();
create trigger appointments_updated_at before update on public.appointments for each row execute procedure public.set_updated_at();
create trigger leads_updated_at before update on public.leads for each row execute procedure public.set_updated_at();
create trigger agent_configs_updated_at before update on public.agent_configs for each row execute procedure public.set_updated_at();
create trigger handoffs_updated_at before update on public.handoffs for each row execute procedure public.set_updated_at();
create trigger integrations_updated_at before update on public.integrations for each row execute procedure public.set_updated_at();

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.organization_members enable row level security;
alter table public.channel_accounts enable row level security;
alter table public.contacts enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.services enable row level security;
alter table public.appointments enable row level security;
alter table public.leads enable row level security;
alter table public.agent_configs enable row level security;
alter table public.handoffs enable row level security;
alter table public.integrations enable row level security;
alter table public.audit_logs enable row level security;

create policy organizations_select on public.organizations for select to authenticated
  using (public.is_organization_member(id));
create policy organizations_update on public.organizations for update to authenticated
  using (public.has_organization_role(id, array['owner','admin']))
  with check (public.has_organization_role(id, array['owner','admin']));

create policy profiles_select_self_or_colleague on public.profiles for select to authenticated
  using (
    id = auth.uid() or exists (
      select 1 from public.organization_members mine
      join public.organization_members theirs on theirs.organization_id = mine.organization_id
      where mine.user_id = auth.uid() and theirs.user_id = profiles.id
    )
  );
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy members_select on public.organization_members for select to authenticated
  using (public.is_organization_member(organization_id));
create policy members_manage on public.organization_members for all to authenticated
  using (public.has_organization_role(organization_id, array['owner','admin']))
  with check (public.has_organization_role(organization_id, array['owner','admin']));

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'channel_accounts', 'contacts', 'conversations', 'messages', 'services',
    'appointments', 'leads', 'agent_configs', 'handoffs', 'integrations'
  ]
  loop
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_organization_member(organization_id))',
      table_name || '_select', table_name
    );
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.has_organization_role(organization_id, array[''owner'',''admin'',''operator''])) with check (public.has_organization_role(organization_id, array[''owner'',''admin'',''operator'']))',
      table_name || '_write', table_name
    );
  end loop;
end $$;

create policy audit_logs_select on public.audit_logs for select to authenticated
  using (organization_id is not null and public.is_organization_member(organization_id));

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

comment on column public.conversations.control_mode is
  'Single source of truth for agent/human control. Agent must only answer when value is agent.';
comment on table public.agent_configs is
  'Versioned snapshot of tenant files; exactly one active configuration per organization.';
comment on table public.messages is
  'Canonical channel-neutral timeline used by the agent and the future independent dashboard.';
