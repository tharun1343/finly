-- Finly database. Run once in Supabase → SQL Editor → New query → Run.
-- One table holds every synced record (settings, categories, commitments) as JSON.
-- Row Level Security makes each row visible only to the account that owns it.

create table if not exists public.records (
  user_id           uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  collection        text        not null check (collection in ('settings', 'cats', 'items')),
  id                text        not null check (char_length(id) between 1 and 64),
  data              jsonb       not null default '{}'::jsonb check (pg_column_size(data) < 200000),
  deleted           boolean     not null default false,
  client_updated_at timestamptz not null,
  server_updated_at timestamptz not null default clock_timestamp(),
  primary key (user_id, collection, id)
);

create index if not exists records_user_sync_idx on public.records (user_id, server_updated_at);

alter table public.records enable row level security;

drop policy if exists "read own records"   on public.records;
drop policy if exists "insert own records" on public.records;
drop policy if exists "update own records" on public.records;
drop policy if exists "delete own records" on public.records;
create policy "read own records"   on public.records for select to authenticated using (user_id = (select auth.uid()));
create policy "insert own records" on public.records for insert to authenticated with check (user_id = (select auth.uid()));
create policy "update own records" on public.records for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "delete own records" on public.records for delete to authenticated using (user_id = (select auth.uid()));

revoke all on public.records from anon;
grant select, insert, update, delete on public.records to authenticated;

-- Newest edit wins: an upload older than what the server already has is ignored,
-- and every accepted write gets a fresh server timestamp so other devices can pull it.
create or replace function public.records_lww()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.client_updated_at < old.client_updated_at then
    return old;
  end if;
  new.server_updated_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists records_lww on public.records;
create trigger records_lww
  before insert or update on public.records
  for each row execute function public.records_lww();
