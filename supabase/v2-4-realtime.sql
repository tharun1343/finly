-- Finly 2.0 server update, part 4: live updates.
-- Lets the app hear about new ledger requests, changes from your other devices and removed devices instantly,
-- instead of on the next refresh. Supabase → SQL Editor → New query → paste → Run. Safe to run again.

do $f1$
declare t text;
begin
  foreach t in array array['ledger_shares', 'records', 'devices'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $f1$;
