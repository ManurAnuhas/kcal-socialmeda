-- Run this whole file once in Supabase -> SQL Editor.
-- Model: one company workspace. Admins manage everything; editors create drafts / submit for approval.

create table if not exists profiles(
  user_id uuid primary key references auth.users on delete cascade,
  email text not null,
  role text not null default 'editor' check (role in ('admin','editor')),
  active boolean not null default true,
  created_at timestamptz default now());

create or replace function public.is_member() returns boolean language sql security definer stable set search_path = public as
$$ select exists(select 1 from profiles where user_id = auth.uid() and active) $$;

create or replace function public.is_admin() returns boolean language sql security definer stable set search_path = public as
$$ select exists(select 1 from profiles where user_id = auth.uid() and active and role = 'admin') $$;

-- The first user created (Auth -> Users -> Add user) becomes admin; everyone after is an editor.
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles(user_id, email, role)
  values (new.id, new.email, case when exists(select 1 from profiles) then 'editor' else 'admin' end)
  on conflict do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create table if not exists accounts(platform text primary key, handle text);                 -- visible to the team
create table if not exists account_secrets(                                                   -- tokens: NO client access at all
  platform text primary key references accounts on delete cascade, token text, ext_id text);

create table if not exists posts(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references profiles(user_id),
  caption text, items text, platforms text[] not null default '{}', media jsonb not null default '{}',
  scheduled_at timestamptz not null default now(),
  status text not null default 'draft' check (status in ('draft','pending','scheduled','publishing','published','failed')),
  error text, created_at timestamptz default now());

create table if not exists audit_log(
  id bigint generated always as identity primary key, at timestamptz default now(),
  user_id uuid, email text, action text, detail text);

-- Performance indices
create index if not exists idx_posts_status_scheduled_at on posts(status, scheduled_at);
create index if not exists idx_posts_user_id on posts(user_id);
create index if not exists idx_audit_log_at on audit_log(at desc);

alter table profiles enable row level security;
alter table accounts enable row level security;
alter table account_secrets enable row level security;   -- no policies = only the service role can read tokens
alter table posts enable row level security;
alter table audit_log enable row level security;

-- Profiles policies
drop policy if exists "members read team" on profiles;
create policy "members read team" on profiles for select using (is_member());

-- Accounts policies
drop policy if exists "members read accounts" on accounts;
create policy "members read accounts" on accounts for select using (is_member());

-- Posts policies
drop policy if exists "members read posts" on posts;
create policy "members read posts" on posts for select using (is_member());

drop policy if exists "create posts" on posts;
create policy "create posts" on posts for insert with check (is_member() and user_id = auth.uid() and (is_admin() or status in ('draft','pending')));

drop policy if exists "update posts" on posts;
create policy "update posts" on posts for update
  using (is_admin() or (user_id = auth.uid() and status in ('draft','pending','failed')))
  with check (is_admin() or (user_id = auth.uid() and status in ('draft','pending')));

drop policy if exists "delete posts" on posts;
create policy "delete posts" on posts for delete using (is_admin() or (user_id = auth.uid() and status in ('draft','pending','failed')));

-- Audit policies
drop policy if exists "admin reads audit" on audit_log;
create policy "admin reads audit" on audit_log for select using (is_admin());

create or replace function public.log_post() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into audit_log(user_id, email, action, detail)
  values (auth.uid(), (select email from profiles where user_id = auth.uid()), lower(tg_op) || ' post',
          coalesce(new.items, old.items, '') || ' · ' || coalesce(new.status, old.status));
  return coalesce(new, old);
end $$;
drop trigger if exists posts_audit on posts;
create trigger posts_audit after insert or update of status or delete on posts for each row execute function public.log_post();

-- Storage policies
insert into storage.buckets(id, name, public) values ('media', 'media', true) on conflict do nothing;

drop policy if exists "members upload media" on storage.objects;
create policy "members upload media" on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and public.is_member() and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "read media" on storage.objects;
create policy "read media" on storage.objects for select using (bucket_id = 'media');

drop policy if exists "admin delete media" on storage.objects;
drop policy if exists "members delete own media" on storage.objects;
create policy "members delete own media" on storage.objects for delete to authenticated
  using (bucket_id = 'media' and (public.is_admin() or (storage.foldername(name))[1] = auth.uid()::text));

alter publication supabase_realtime add table posts;
alter publication supabase_realtime add table accounts;

-- Scheduler (every minute). Enable pg_cron + pg_net first, replace the placeholders, uncomment, run.
-- select cron.schedule('publisher-every-minute', '* * * * *', $$
--   select net.http_post(url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/publisher',
--     headers := '{"Authorization":"Bearer YOUR_ANON_KEY"}'::jsonb) $$);
