-- Finly 2.0 server update, part 3 of 3: shared ledger entries.
-- Supabase → SQL Editor → New query → paste this whole file → Run. Run parts 1, 2, 3 in order.
-- Safe to run again.

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
returns text language plpgsql security definer set search_path = '' as $f1$
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
end; $f1$;

-- The other person accepts or declines.
create or replace function public.share_respond(p_id text, p_accept boolean)
returns void language plpgsql security definer set search_path = '' as $f2$
begin
  update public.ledger_shares set status = case when p_accept then 'accepted' else 'declined' end, updated_at = clock_timestamp()
    where id = p_id and counterpart = auth.uid() and status in ('pending', 'accepted');
  if not found then raise exception 'not found'; end if;
end; $f2$;

-- Either side records a payment once the entry is accepted. p_payment = { id, date, amount, by }.
create or replace function public.share_add_payment(p_id text, p_payment jsonb)
returns void language plpgsql security definer set search_path = '' as $f3$
begin
  update public.ledger_shares
    set data = jsonb_set(data, '{payments}', coalesce(data -> 'payments', '[]'::jsonb) || jsonb_build_array(p_payment)), updated_at = clock_timestamp()
    where id = p_id and (owner = auth.uid() or (counterpart = auth.uid() and status = 'accepted'))
      and not exists (select 1 from jsonb_array_elements(coalesce(data -> 'payments', '[]'::jsonb)) x where x ->> 'id' = p_payment ->> 'id');
end; $f3$;

-- The creator deletes the entry; it disappears from the other person's ledger too.
create or replace function public.share_remove(p_id text)
returns void language sql security definer set search_path = '' as $f4$
  update public.ledger_shares set status = 'removed', updated_at = clock_timestamp() where id = p_id and owner = auth.uid();
$f4$;

revoke all on function public.share_upsert(text, text, text, jsonb), public.share_respond(text, boolean),
  public.share_add_payment(text, jsonb), public.share_remove(text) from public, anon;
grant execute on function public.share_upsert(text, text, text, jsonb), public.share_respond(text, boolean),
  public.share_add_payment(text, jsonb), public.share_remove(text) to authenticated;
