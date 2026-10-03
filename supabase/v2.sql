-- Finly 2.0 additions. Run once in Supabase → SQL Editor → New query → Run (after schema.sql).
-- Safe to run again: everything is "if not exists" / "or replace".

/* =====================================================================
   DEVICES — every phone or browser signed in to an account
===================================================================== */
create table if not exists public.devices (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  id         text        not null check (char_length(id) between 8 and 64),
  name       text        not null default '' check (char_length(name) <= 80),
  platform   text        not null default '' check (char_length(platform) <= 40),
  city       text        not null default '' check (char_length(city) <= 80),
  session_id uuid,
  created_at timestamptz not null default now(),
  last_seen  timestamptz not null default now(),
  revoked    boolean     not null default false,
  primary key (user_id, id)
);
alter table public.devices enable row level security;
drop policy if exists "read own devices" on public.devices;
create policy "read own devices" on public.devices for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.devices from anon, authenticated;
grant select on public.devices to authenticated;

-- Called by the app on start. Returns { revoked, is_new, others } — others = other active devices.
create or replace function public.register_device(p_id text, p_name text, p_platform text, p_city text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  sid uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  row public.devices;
  fresh boolean := false;
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into row from public.devices where user_id = me and id = p_id;
  if found and row.revoked then
    return jsonb_build_object('revoked', true, 'is_new', false, 'others', 0);
  end if;
  if not found then
    fresh := true;
    insert into public.devices (user_id, id, name, platform, city, session_id)
      values (me, p_id, left(coalesce(p_name, ''), 80), left(coalesce(p_platform, ''), 40), left(coalesce(p_city, ''), 80), sid);
  else
    update public.devices set name = left(coalesce(nullif(p_name, ''), name), 80), platform = left(coalesce(nullif(p_platform, ''), platform), 40),
      city = left(coalesce(nullif(p_city, ''), city), 80), session_id = coalesce(sid, session_id), last_seen = now()
      where user_id = me and id = p_id;
  end if;
  return jsonb_build_object('revoked', false, 'is_new', fresh,
    'others', (select count(*) from public.devices where user_id = me and id <> p_id and not revoked));
end; $$;

-- Signs another device out: marks it removed and deletes its login session (refresh tokens stop working).
create or replace function public.revoke_device(p_id text)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); sid uuid;
begin
  if me is null then raise exception 'not signed in'; end if;
  update public.devices set revoked = true where user_id = me and id = p_id returning session_id into sid;
  if sid is not null then delete from auth.sessions where id = sid and user_id = me; end if;
end; $$;

-- Removes a signed-out device from the list entirely.
create or replace function public.forget_device(p_id text)
returns void language sql security definer set search_path = '' as $$
  delete from public.devices where user_id = auth.uid() and id = p_id and revoked;
$$;

revoke all on function public.register_device(text, text, text, text), public.revoke_device(text), public.forget_device(text) from public, anon;
grant execute on function public.register_device(text, text, text, text), public.revoke_device(text), public.forget_device(text) to authenticated;

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
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'not signed in'; end if;
  if exists (select 1 from public.profiles where phone = p_phone and user_id <> me) then raise exception 'phone_taken'; end if;
  insert into public.profiles (user_id, phone, name) values (me, p_phone, left(coalesce(p_name, ''), 60))
    on conflict (user_id) do update set phone = excluded.phone, name = excluded.name, updated_at = now();
  -- entries other people shared with this number before it joined now reach this account
  update public.ledger_shares set counterpart = me, updated_at = clock_timestamp()
    where counterpart is null and counterpart_phone = p_phone and owner <> me;
end; $$;

/* =====================================================================
   SHARED LEDGER — an entry one person adds appears (inverted) in the other's ledger
===================================================================== */
create table if not exists public.ledger_shares (
  id                text        primary key check (char_length(id) between 8 and 64),
  owner             uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  owner_name        text        not null default '' check (char_length(owner_name) <= 60),
  owner_phone       text        not null default '',
  counterpart       uuid        references auth.users (id) on delete set null,
  counterpart_phone text        not null check (counterpart_phone ~ '^\+[1-9][0-9]{7,14}$'),
  status            text        not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'removed')),
  data              jsonb       not null check (pg_column_size(data) < 100000),
  created_at        timestamptz not null default clock_timestamp(),
  updated_at        timestamptz not null default clock_timestamp()
);
create index if not exists ledger_shares_counterpart_idx on public.ledger_shares (counterpart);
alter table public.ledger_shares enable row level security;
drop policy if exists "read own shares" on public.ledger_shares;
create policy "read own shares" on public.ledger_shares for select to authenticated
  using (owner = (select auth.uid()) or counterpart = (select auth.uid()));
revoke all on public.ledger_shares from anon, authenticated;
grant select on public.ledger_shares to authenticated;

-- The creator adds or updates an entry (amount, date, interest, tenure, payments).
-- Returns 'linked' when the number belongs to a Finly account, else 'waiting'.
create or replace function public.share_upsert(p_id text, p_phone text, p_owner_name text, p_data jsonb)
returns text language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); cp uuid; row public.ledger_shares; my_phone text;
begin
  if me is null then raise exception 'not signed in'; end if;
  select user_id into cp from public.profiles where phone = p_phone and user_id <> me;
  select phone into my_phone from public.profiles where user_id = me;
  select * into row from public.ledger_shares where id = p_id;
  if found then
    if row.owner <> me then raise exception 'not yours'; end if;
    update public.ledger_shares set data = p_data, owner_name = left(coalesce(p_owner_name, ''), 60), owner_phone = coalesce(my_phone, ''),
      counterpart_phone = p_phone, counterpart = cp,
      status = case when row.counterpart_phone <> p_phone or row.status = 'removed' then 'pending' else row.status end,
      updated_at = clock_timestamp() where id = p_id;
  else
    insert into public.ledger_shares (id, owner, owner_name, owner_phone, counterpart, counterpart_phone, data)
      values (p_id, me, left(coalesce(p_owner_name, ''), 60), coalesce(my_phone, ''), cp, p_phone, p_data);
  end if;
  return case when cp is null then 'waiting' else 'linked' end;
end; $$;

-- The other person accepts or declines.
create or replace function public.share_respond(p_id text, p_accept boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.ledger_shares set status = case when p_accept then 'accepted' else 'declined' end, updated_at = clock_timestamp()
    where id = p_id and counterpart = auth.uid() and status in ('pending', 'accepted');
  if not found then raise exception 'not found'; end if;
end; $$;

-- Either side records a payment once the entry is accepted. p_payment = { id, date, amount, by }.
create or replace function public.share_add_payment(p_id text, p_payment jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.ledger_shares
    set data = jsonb_set(data, '{payments}', coalesce(data -> 'payments', '[]'::jsonb) || jsonb_build_array(p_payment)), updated_at = clock_timestamp()
    where id = p_id and (owner = auth.uid() or (counterpart = auth.uid() and status = 'accepted'))
      and not exists (select 1 from jsonb_array_elements(coalesce(data -> 'payments', '[]'::jsonb)) x where x ->> 'id' = p_payment ->> 'id');
end; $$;

-- The creator deletes the entry; it disappears from the other person's ledger too.
create or replace function public.share_remove(p_id text)
returns void language sql security definer set search_path = '' as $$
  update public.ledger_shares set status = 'removed', updated_at = clock_timestamp() where id = p_id and owner = auth.uid();
$$;

revoke all on function public.save_profile(text, text), public.share_upsert(text, text, text, jsonb), public.share_respond(text, boolean),
  public.share_add_payment(text, jsonb), public.share_remove(text) from public, anon;
grant execute on function public.save_profile(text, text), public.share_upsert(text, text, text, jsonb), public.share_respond(text, boolean),
  public.share_add_payment(text, jsonb), public.share_remove(text) to authenticated;
