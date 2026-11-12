-- CA ControlRoom: database setup for Supabase (free plan).
-- Paste this whole file into Supabase > SQL Editor > New query, then click Run.
-- It is safe to run again: it only creates what is missing.

create extension if not exists pgcrypto;

-- One firm per installation.
create table if not exists public.firms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

-- Who can log in, and their role.
create table if not exists public.members (
  firm_id uuid not null references public.firms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  name text not null default '',
  phone text not null default '',
  role text not null default 'staff' check (role in ('partner','staff','article')),
  created_at timestamptz not null default now(),
  primary key (firm_id, user_id)
);
create unique index if not exists members_one_firm_per_user on public.members(user_id);

-- People a partner has invited but who have not signed up yet.
create table if not exists public.invites (
  firm_id uuid not null references public.firms(id) on delete cascade,
  email text not null,
  name text not null default '',
  phone text not null default '',
  role text not null default 'staff' check (role in ('partner','staff','article')),
  created_at timestamptz not null default now(),
  primary key (firm_id, email)
);

-- The tool's saved data (clients, tracker, assignments, rates, rules...).
-- One row per data set, same keys the single-file tool used (ca.clients, ca.cm, ...).
create table if not exists public.kv (
  firm_id uuid not null references public.firms(id) on delete cascade,
  key text not null,
  value text not null,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (firm_id, key)
);

-- Every save is also kept here, so a mistake can be undone (last 90 days are enough).
create table if not exists public.kv_history (
  id bigint generated always as identity primary key,
  firm_id uuid not null references public.firms(id) on delete cascade,
  key text not null,
  value text,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
create index if not exists kv_history_lookup on public.kv_history(firm_id, key, updated_at desc);

-- ---------- helper functions ----------
create or replace function public.my_firm() returns uuid
language sql stable security definer set search_path = public as $$
  select firm_id from public.members where user_id = auth.uid() limit 1
$$;

create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.members where user_id = auth.uid() limit 1
$$;

-- True when no firm has been created yet (first login sets up the firm).
create or replace function public.firm_exists() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.firms)
$$;

-- The very first person to sign in creates the firm and becomes its partner.
-- After that, nobody can create another firm: new people need an invite.
create or replace function public.create_firm(firm_name text, my_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare f uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  perform pg_advisory_xact_lock(4242);
  if exists(select 1 from public.firms) then raise exception 'The firm is already set up. Ask a partner to invite you.'; end if;
  insert into public.firms(name) values (coalesce(nullif(trim(firm_name),''),'My firm')) returning id into f;
  insert into public.members(firm_id,user_id,email,name,role)
    values (f, auth.uid(), coalesce(auth.jwt()->>'email',''), coalesce(my_name,''), 'partner');
  return f;
end $$;

-- Called after every login: if a partner invited this email, add the person to the firm.
create or replace function public.join_invite()
returns text language plpgsql security definer set search_path = public as $$
declare inv public.invites; em text := lower(coalesce(auth.jwt()->>'email',''));
begin
  if auth.uid() is null then return 'no-user'; end if;
  if exists(select 1 from public.members where user_id = auth.uid()) then return 'member'; end if;
  select * into inv from public.invites where lower(email) = em limit 1;
  if not found then return 'no-invite'; end if;
  insert into public.members(firm_id,user_id,email,name,phone,role)
    values (inv.firm_id, auth.uid(), em, inv.name, inv.phone, inv.role);
  delete from public.invites where firm_id = inv.firm_id and lower(email) = em;
  return 'joined';
end $$;

-- Keep a history copy of every save.
create or replace function public.kv_keep_history() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.kv_history(firm_id,key,value,updated_by,updated_at)
    values (coalesce(new.firm_id, old.firm_id), coalesce(new.key, old.key),
            case when tg_op = 'DELETE' then null else new.value end,
            auth.uid(), now());
  delete from public.kv_history where updated_at < now() - interval '90 days';
  return null;
end $$;
drop trigger if exists kv_history_trg on public.kv;
create trigger kv_history_trg after insert or update or delete on public.kv
  for each row execute function public.kv_keep_history();

-- Stamp who saved and when.
create or replace function public.kv_stamp() returns trigger
language plpgsql as $$
begin
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists kv_stamp_trg on public.kv;
create trigger kv_stamp_trg before insert or update on public.kv
  for each row execute function public.kv_stamp();

-- ---------- security: each person sees only their firm ----------
alter table public.firms enable row level security;
alter table public.members enable row level security;
alter table public.invites enable row level security;
alter table public.kv enable row level security;
alter table public.kv_history enable row level security;

-- Keys an article assistant may not read or change (fees and firm settings).
create or replace function public.key_allowed(k text) returns boolean
language sql stable as $$
  select coalesce(public.my_role(),'') in ('partner','staff')
      or k not in ('ca.as','ca.rates','ca.fees','ca.inv')
$$;

drop policy if exists firms_read on public.firms;
create policy firms_read on public.firms for select using (id = public.my_firm());
drop policy if exists firms_update on public.firms;
create policy firms_update on public.firms for update using (id = public.my_firm() and public.my_role() = 'partner');

drop policy if exists members_read on public.members;
create policy members_read on public.members for select using (firm_id = public.my_firm());
drop policy if exists members_partner_update on public.members;
create policy members_partner_update on public.members for update
  using (firm_id = public.my_firm() and public.my_role() = 'partner');
drop policy if exists members_self_update on public.members;
create policy members_self_update on public.members for update
  using (user_id = auth.uid()) with check (user_id = auth.uid() and role = public.my_role());
drop policy if exists members_partner_delete on public.members;
create policy members_partner_delete on public.members for delete
  using (firm_id = public.my_firm() and public.my_role() = 'partner' and user_id <> auth.uid());

drop policy if exists invites_partner on public.invites;
create policy invites_partner on public.invites for all
  using (firm_id = public.my_firm() and public.my_role() = 'partner')
  with check (firm_id = public.my_firm() and public.my_role() = 'partner');

drop policy if exists kv_read on public.kv;
create policy kv_read on public.kv for select
  using (firm_id = public.my_firm() and public.key_allowed(key));
drop policy if exists kv_insert on public.kv;
create policy kv_insert on public.kv for insert
  with check (firm_id = public.my_firm() and public.key_allowed(key));
drop policy if exists kv_update on public.kv;
create policy kv_update on public.kv for update
  using (firm_id = public.my_firm() and public.key_allowed(key))
  with check (firm_id = public.my_firm() and public.key_allowed(key));
drop policy if exists kv_delete on public.kv;
create policy kv_delete on public.kv for delete
  using (firm_id = public.my_firm() and public.my_role() in ('partner','staff'));

drop policy if exists kv_history_read on public.kv_history;
create policy kv_history_read on public.kv_history for select
  using (firm_id = public.my_firm() and public.my_role() = 'partner');

grant execute on function public.my_firm(), public.my_role(), public.firm_exists(),
  public.create_firm(text,text), public.join_invite(), public.key_allowed(text) to authenticated;

-- Live updates: when a colleague saves, other open screens hear about it.
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='kv') then
    execute 'alter publication supabase_realtime add table public.kv';
  end if;
end $$;

-- =====================================================================
-- Phase 3: records (invoices, payments, time logs), client upload links,
-- document inbox and file storage.
-- =====================================================================

-- One row per invoice / payment / time entry, so many people can save at once.
create table if not exists public.records (
  firm_id uuid not null references public.firms(id) on delete cascade,
  kind text not null,
  id text not null,
  data jsonb not null default '{}'::jsonb,
  deleted boolean not null default false,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (firm_id, kind, id)
);
drop trigger if exists records_stamp_trg on public.records;
create trigger records_stamp_trg before insert or update on public.records
  for each row execute function public.kv_stamp();
alter table public.records enable row level security;

-- Articles do not see invoices or payments; they may only change their own time entries.
create or replace function public.kind_allowed(k text) returns boolean
language sql stable as $$
  select coalesce(public.my_role(),'') in ('partner','staff') or k not in ('invoice','payment')
$$;
drop policy if exists records_read on public.records;
create policy records_read on public.records for select
  using (firm_id = public.my_firm() and public.kind_allowed(kind));
drop policy if exists records_insert on public.records;
create policy records_insert on public.records for insert
  with check (firm_id = public.my_firm() and public.kind_allowed(kind)
    and (kind <> 'time' or public.my_role() in ('partner','staff') or data->>'by' = auth.uid()::text));
drop policy if exists records_update on public.records;
create policy records_update on public.records for update
  using (firm_id = public.my_firm() and public.kind_allowed(kind)
    and (kind <> 'time' or public.my_role() in ('partner','staff') or data->>'by' = auth.uid()::text))
  with check (firm_id = public.my_firm() and public.kind_allowed(kind));

-- Upload links handed to clients. The token is the secret in the link.
create table if not exists public.client_links (
  token text primary key,
  firm_id uuid not null references public.firms(id) on delete cascade,
  client text not null,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.client_links enable row level security;
drop policy if exists links_members on public.client_links;
create policy links_members on public.client_links for all
  using (firm_id = public.my_firm())
  with check (firm_id = public.my_firm() and public.my_role() in ('partner','staff'));

-- Files clients have uploaded.
create table if not exists public.inbox_files (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  token text not null,
  client text not null,
  path text not null,
  name text not null,
  size bigint not null default 0,
  note text not null default '',
  status text not null default 'new',
  reviewed_by uuid references auth.users(id) on delete set null,
  uploaded_at timestamptz not null default now()
);
alter table public.inbox_files enable row level security;
drop policy if exists inbox_read on public.inbox_files;
create policy inbox_read on public.inbox_files for select using (firm_id = public.my_firm());
drop policy if exists inbox_update on public.inbox_files;
create policy inbox_update on public.inbox_files for update using (firm_id = public.my_firm()) with check (firm_id = public.my_firm());
drop policy if exists inbox_delete on public.inbox_files;
create policy inbox_delete on public.inbox_files for delete using (firm_id = public.my_firm() and public.my_role() in ('partner','staff'));

create or replace function public.link_ok(t text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.client_links where token = t and active)
$$;

-- What the client's upload page shows (no login needed).
create or replace function public.link_info(t text) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object('client', l.client, 'firm', f.name)
  from public.client_links l join public.firms f on f.id = l.firm_id
  where l.token = t and l.active
$$;

-- Called by the upload page after each file is stored.
create or replace function public.inbox_add(t text, p text, n text, s bigint, note text)
returns void language plpgsql security definer set search_path = public as $$
declare l public.client_links;
begin
  select * into l from public.client_links where token = t and active;
  if not found then raise exception 'This upload link is not active'; end if;
  if split_part(p, '/', 1) <> t then raise exception 'Bad file path'; end if;
  insert into public.inbox_files(firm_id, token, client, path, name, size, note)
    values (l.firm_id, t, l.client, p, left(n, 200), s, left(coalesce(note,''), 1000));
end $$;

grant execute on function public.link_ok(text), public.link_info(text),
  public.inbox_add(text,text,text,bigint,text) to anon, authenticated;
grant execute on function public.kind_allowed(text) to authenticated;

-- File storage: a private bucket, 20 MB per file. Clients can only add files
-- under their own link's folder; only the firm can read them.
do $$ begin
  if exists (select 1 from information_schema.tables where table_schema='storage' and table_name='buckets') then
    insert into storage.buckets (id, name, public, file_size_limit)
      values ('inbox', 'inbox', false, 20971520) on conflict (id) do nothing;
    execute 'drop policy if exists inbox_upload on storage.objects';
    execute $p$create policy inbox_upload on storage.objects for insert to anon, authenticated
      with check (bucket_id = 'inbox' and public.link_ok((storage.foldername(name))[1]))$p$;
    execute 'drop policy if exists inbox_staff_read on storage.objects';
    execute $p$create policy inbox_staff_read on storage.objects for select to authenticated
      using (bucket_id = 'inbox' and exists (select 1 from public.client_links l
        where l.token = (storage.foldername(name))[1] and l.firm_id = public.my_firm()))$p$;
    execute 'drop policy if exists inbox_staff_delete on storage.objects';
    execute $p$create policy inbox_staff_delete on storage.objects for delete to authenticated
      using (bucket_id = 'inbox' and public.my_role() in ('partner','staff') and exists (select 1 from public.client_links l
        where l.token = (storage.foldername(name))[1] and l.firm_id = public.my_firm()))$p$;
  end if;
end $$;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='records') then
      execute 'alter publication supabase_realtime add table public.records'; end if;
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='inbox_files') then
      execute 'alter publication supabase_realtime add table public.inbox_files'; end if;
  end if;
end $$;
