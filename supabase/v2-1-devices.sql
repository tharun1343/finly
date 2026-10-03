-- Finly 2.0 server update, part 1 of 3: devices.
-- Supabase → SQL Editor → New query → paste this whole file → Run. Run parts 1, 2, 3 in order.
-- Safe to run again.

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
returns jsonb language plpgsql security definer set search_path = '' as $f1$
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
end; $f1$;

-- Signs another device out: marks it removed and deletes its login session (refresh tokens stop working).
create or replace function public.revoke_device(p_id text)
returns void language plpgsql security definer set search_path = '' as $f2$
declare me uuid := auth.uid(); sid uuid;
begin
  if me is null then raise exception 'not signed in'; end if;
  update public.devices set revoked = true where user_id = me and id = p_id returning session_id into sid;
  if sid is not null then delete from auth.sessions where id = sid and user_id = me; end if;
end; $f2$;

-- Removes a signed-out device from the list entirely.
create or replace function public.forget_device(p_id text)
returns void language sql security definer set search_path = '' as $f3$
  delete from public.devices where user_id = auth.uid() and id = p_id and revoked;
$f3$;

revoke all on function public.register_device(text, text, text, text), public.revoke_device(text), public.forget_device(text) from public, anon;
grant execute on function public.register_device(text, text, text, text), public.revoke_device(text), public.forget_device(text) to authenticated;

