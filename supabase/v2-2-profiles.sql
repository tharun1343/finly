-- Finly 2.0 server update, part 2 of 3: WhatsApp number (profiles).
-- Supabase → SQL Editor → New query → paste this whole file → Run. Run parts 1, 2, 3 in order.
-- Safe to run again.

/* =====================================================================
   PROFILES — the WhatsApp number, used to find people for shared ledger entries
===================================================================== */
create table if not exists public.profiles (
  user_id    uuid        primary key default auth.uid() references auth.users (id) on delete cascade,
  phone      text        unique check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  name       text        not null default '' check (char_length(name) <= 60),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;

-- Saves my number. Fails with 'phone_taken' if another account already uses it.
create or replace function public.save_profile(p_phone text, p_name text)
returns void language plpgsql security definer set search_path = '' as $f1$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'not signed in'; end if;
  if exists (select 1 from public.profiles where phone = p_phone and user_id <> me) then raise exception 'phone_taken'; end if;
  insert into public.profiles (user_id, phone, name) values (me, p_phone, left(coalesce(p_name, ''), 60))
    on conflict (user_id) do update set phone = excluded.phone, name = excluded.name, updated_at = now();
  -- entries other people shared with this number before it joined now reach this account
  update public.ledger_shares set counterpart = me, updated_at = clock_timestamp()
    where counterpart is null and counterpart_phone = p_phone and owner <> me;
end; $f1$;

revoke all on function public.save_profile(text, text) from public, anon;
grant execute on function public.save_profile(text, text) to authenticated;
