-- Staff logins and activity log (feature 4 of the admin tools PR).
--
-- Safe to run more than once. Run it AFTER the SQL of PRs #15, #16, #18 and
-- #19 if those are run the same day; if one of them is run later, run the
-- last section of this file ("Attach the log") again, so their tables are
-- logged too.
--
-- 1. profiles.active: the admin can switch a login off without deleting it.
--    A switched-off person can no longer add or see expenses, and a
--    switched-off admin is no longer admin. Row level security is only made
--    stricter here, never looser.
-- 2. At least one active admin always remains (a trigger refuses the change
--    that would remove the last one), so nobody can lock everyone out.
-- 3. admin_login_info(): for the admin only, each login's email and when it
--    last signed in (kept by Supabase in auth.users).
-- 4. activity_log: who added, changed or deleted what, and when. Written only
--    by database triggers, so it records changes made from the app and from
--    the SQL editor alike, and nobody can edit or delete its rows through the
--    app. The admin can read it.

-- ---------------------------------------------------------------------------
-- 1. Switch a login off
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists active boolean not null default true;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin' and active
  );
$$;

create or replace function private.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active);
$$;
revoke execute on function private.is_active_user() from public, anon;
grant execute on function private.is_active_user() to authenticated;

alter policy "add own expenses" on public.expenses
  with check (entered_by = (select auth.uid()) and (select private.is_active_user()));
alter policy "read own expenses" on public.expenses
  using (entered_by = (select auth.uid()) and (select private.is_active_user()));

-- ---------------------------------------------------------------------------
-- 2. Never remove the last active admin
-- ---------------------------------------------------------------------------
create or replace function private.keep_one_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role = 'admin' and old.active
     and (tg_op = 'DELETE' or new.role <> 'admin' or not new.active)
     and not exists (select 1 from public.profiles where role = 'admin' and active and id <> old.id) then
    raise exception 'LAST_ADMIN' using errcode = 'P0001', hint = 'At least one active admin must remain.';
  end if;
  return coalesce(new, old);
end;
$$;
revoke execute on function private.keep_one_admin() from public, anon, authenticated;

drop trigger if exists keep_one_admin on public.profiles;
create trigger keep_one_admin
  before update or delete on public.profiles
  for each row execute function private.keep_one_admin();

-- ---------------------------------------------------------------------------
-- 3. Email and last sign-in for the Staff page (admin only)
-- ---------------------------------------------------------------------------
create or replace function public.admin_login_info()
returns table (id uuid, email text, last_sign_in_at timestamptz, created_at timestamptz, confirmed boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select u.id, u.email::text, u.last_sign_in_at, u.created_at, (u.email_confirmed_at is not null)
  from auth.users u
  where (select private.is_admin());
$$;
revoke execute on function public.admin_login_info() from public, anon;
grant execute on function public.admin_login_info() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Activity log
-- ---------------------------------------------------------------------------
create table if not exists public.activity_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  -- Empty when the change was made in the SQL editor rather than the app.
  actor uuid,
  action text not null check (action in ('add', 'change', 'delete')),
  entity text not null,
  entity_id text,
  -- add: the new row. change: only the fields that changed, before and after. delete: the old row.
  before jsonb,
  after jsonb
);
create index if not exists activity_log_at_idx on public.activity_log (at desc);
create index if not exists activity_log_actor_idx on public.activity_log (actor, at desc);
create index if not exists activity_log_entity_idx on public.activity_log (entity, at desc);

alter table public.activity_log enable row level security;
drop policy if exists "admin read activity log" on public.activity_log;
create policy "admin read activity log" on public.activity_log
  for select to authenticated using ((select private.is_admin()));
-- Read only through the API: rows come only from the trigger below.
revoke all on public.activity_log from anon, authenticated;
grant select on public.activity_log to authenticated;

create or replace function private.log_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_before jsonb;
  v_after jsonb;
begin
  if tg_op = 'UPDATE' then
    select jsonb_object_agg(n.key, v_old -> n.key), jsonb_object_agg(n.key, n.value)
      into v_before, v_after
      from jsonb_each(v_new) n
      where v_old -> n.key is distinct from n.value;
    if v_after is null then
      return new; -- nothing really changed
    end if;
    -- Keep a name or amount so the log line still says which row it was.
    v_before := v_before || jsonb_strip_nulls(jsonb_build_object(
      'name', v_old -> 'name', 'pattern', v_old -> 'pattern', 'narration', v_old -> 'narration',
      'amount', v_old -> 'amount', 'date', v_old -> 'date', 'txn_date', v_old -> 'txn_date'));
  elsif tg_op = 'INSERT' then
    v_after := v_new;
  else
    v_before := v_old;
  end if;

  insert into public.activity_log (actor, action, entity, entity_id, before, after)
  values (
    auth.uid(),
    case tg_op when 'INSERT' then 'add' when 'UPDATE' then 'change' else 'delete' end,
    tg_table_name,
    coalesce(v_new, v_old) ->> coalesce(tg_argv[0], 'id'),
    v_before,
    v_after
  );
  return coalesce(new, old);
end;
$$;
revoke execute on function private.log_activity() from public, anon, authenticated;

-- Adds the log trigger to a table if that table exists (some come from other PRs).
create or replace function private.attach_activity_log(p_table text, p_key text default 'id', p_events text default 'insert or update or delete')
returns void
language plpgsql
set search_path = ''
as $$
begin
  if to_regclass('public.' || p_table) is null then
    return;
  end if;
  execute format('drop trigger if exists log_activity on public.%I', p_table);
  execute format(
    'create trigger log_activity after %s on public.%I for each row execute function private.log_activity(%L)',
    p_events, p_table, p_key);
end;
$$;
revoke execute on function private.attach_activity_log(text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Attach the log (run this section again after any later PR's SQL)
-- ---------------------------------------------------------------------------
select private.attach_activity_log('expenses');
select private.attach_activity_log('categories', 'name');
select private.attach_activity_log('payees');
select private.attach_activity_log('bank_rules');
select private.attach_activity_log('import_batches', 'id', 'insert or delete');
-- Bank and PappyJoe rows are added by the hundred on import; the import itself
-- is logged above, so only later changes to a bank row are logged.
select private.attach_activity_log('bank_transactions', 'id', 'update');
select private.attach_activity_log('profiles', 'id', 'update or delete');
select private.attach_activity_log('card_payments', 'id', 'update or delete');
select private.attach_activity_log('petty_cash_transfers');
select private.attach_activity_log('recon_notes', 'month');
select private.attach_activity_log('recon_reasons', 'month');
select private.attach_activity_log('clinics', 'id', 'update');
-- Tables from PRs #15, #16, #18, #19 (skipped quietly if not created yet).
select private.attach_activity_log('gap_reasons');
select private.attach_activity_log('gap_answers');
select private.attach_activity_log('gap_rules');
select private.attach_activity_log('petty_count_reasons');
select private.attach_activity_log('petty_cash_counts');
select private.attach_activity_log('import_deletions', 'id', 'insert');
select private.attach_activity_log('category_changes', 'id', 'insert');
-- Tables from this PR's later features (skipped quietly if not created yet;
-- their own SQL attaches them too).
select private.attach_activity_log('month_closes', 'month');
select private.attach_activity_log('recurring_templates');
