-- Finly 2.2 server update: shared ledger payments need the other person's OK, and delete works per person.
-- Supabase → SQL Editor → New query → paste this whole file → Run. Needs v2-3 first. Safe to run again.

alter table public.ledger_shares add column if not exists owner_hidden boolean not null default false;
alter table public.ledger_shares add column if not exists counterpart_hidden boolean not null default false;

-- The creator adds or updates an entry. Payments are merged by id, so a payment the other person
-- recorded (or a confirmation they gave) is never overwritten by an older copy.
create or replace function public.share_upsert(p_id text, p_phone text, p_owner_name text, p_data jsonb)
returns text language plpgsql security definer set search_path = '' as $u1$
declare me uuid := auth.uid(); cp uuid; old public.ledger_shares; my_phone text; pays jsonb;
begin
  if me is null then raise exception 'not signed in'; end if;
  select user_id into cp from public.profiles where phone = p_phone and user_id <> me;
  select phone into my_phone from public.profiles where user_id = me;
  select * into old from public.ledger_shares where id = p_id;
  if found then
    if old.owner <> me then raise exception 'not yours'; end if;
    select coalesce(old.data -> 'payments', '[]'::jsonb) || coalesce(jsonb_agg(n), '[]'::jsonb) into pays
      from jsonb_array_elements(coalesce(p_data -> 'payments', '[]'::jsonb)) n
      where not exists (select 1 from jsonb_array_elements(coalesce(old.data -> 'payments', '[]'::jsonb)) o where o ->> 'id' = n ->> 'id');
    update public.ledger_shares set data = jsonb_set(p_data, '{payments}', pays), owner_name = left(coalesce(p_owner_name, ''), 60),
      owner_phone = coalesce(my_phone, ''), counterpart_phone = p_phone, counterpart = cp, owner_hidden = false,
      counterpart_hidden = case when old.counterpart_phone <> p_phone then false else old.counterpart_hidden end,
      status = case when old.counterpart_phone <> p_phone or old.status = 'removed' then 'pending' else old.status end,
      updated_at = clock_timestamp() where id = p_id;
  else
    insert into public.ledger_shares (id, owner, owner_name, owner_phone, counterpart, counterpart_phone, data)
      values (p_id, me, left(coalesce(p_owner_name, ''), 60), coalesce(my_phone, ''), cp, p_phone, p_data);
  end if;
  return case when cp is null then 'waiting' else 'linked' end;
end; $u1$;

-- The person who did NOT record a payment accepts (true) or rejects (false) it.
create or replace function public.share_confirm(p_id text, p_pay_id text, p_ok boolean)
returns void language plpgsql security definer set search_path = '' as $u2$
declare me uuid := auth.uid();
begin
  update public.ledger_shares s set data = jsonb_set(s.data, '{payments}', (
      select coalesce(jsonb_agg(case when x ->> 'id' = p_pay_id and coalesce(x ->> 'by', '') <> me::text and x ->> 'st' = 'pending'
        then x || jsonb_build_object('st', case when p_ok then 'ok' else 'no' end) else x end), '[]'::jsonb)
      from jsonb_array_elements(coalesce(s.data -> 'payments', '[]'::jsonb)) x)), updated_at = clock_timestamp()
    where s.id = p_id and (s.owner = me or (s.counterpart = me and s.status = 'accepted'));
  if not found then raise exception 'not found'; end if;
end; $u2$;

-- Delete from MY ledger only. The row goes away once both people have deleted it.
create or replace function public.share_hide(p_id text)
returns void language plpgsql security definer set search_path = '' as $u3$
declare me uuid := auth.uid();
begin
  update public.ledger_shares set owner_hidden = owner_hidden or owner = me,
    counterpart_hidden = counterpart_hidden or counterpart = me, updated_at = clock_timestamp()
    where id = p_id and (owner = me or counterpart = me);
  delete from public.ledger_shares where id = p_id and owner_hidden and (counterpart_hidden or counterpart is null or status <> 'accepted');
end; $u3$;

revoke all on function public.share_confirm(text, text, boolean), public.share_hide(text) from public, anon;
grant execute on function public.share_confirm(text, text, boolean), public.share_hide(text) to authenticated;
