-- Month close (feature 5 of the admin tools PR).
--
-- Safe to run more than once. Run it AFTER the SQL of PRs #15, #16, #18 and
-- #19 if those are run the same day; if one of them is run later, run the
-- last section ("Lock the tables") again so its table is locked too.
--
-- * month_closes: one row per month that was ever closed; closed = true while
--   it is closed. checklist keeps the checklist as it stood at closing.
-- * month_close_events: every close and reopen, with who, when and why.
--   Nobody can edit or remove these rows through the app.
-- * close_month / reopen_month: the only way to change the two tables (admin
--   only). A month can be closed once it is over (India time); reopening needs
--   a reason of at least 5 characters.
-- * A trigger on every table with dated money rows refuses to add, change or
--   delete a row dated in a closed month, whoever tries (app, other PRs'
--   functions such as delete_imported_month, or the SQL editor). It says
--   MONTH_CLOSED:YYYY-MM so the app can explain. Renaming a category still
--   works: the renamed name flows into closed months' rows, nothing else.
--   card_payments is NOT locked: card money from a closed month can still be
--   marked as credited when it reaches the bank.

create table if not exists public.month_closes (
  month text primary key check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  closed boolean not null default true,
  closed_by uuid references auth.users (id),
  closed_at timestamptz,
  note text not null default '' check (length(note) <= 500),
  checklist jsonb not null default '[]'::jsonb,
  reopened_by uuid references auth.users (id),
  reopened_at timestamptz,
  reopen_reason text check (length(reopen_reason) <= 500)
);
create index if not exists month_closes_closed_by_idx on public.month_closes (closed_by);
create index if not exists month_closes_reopened_by_idx on public.month_closes (reopened_by);

create table if not exists public.month_close_events (
  id bigint generated always as identity primary key,
  month text not null check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  action text not null check (action in ('close', 'reopen')),
  reason text not null default '',
  checklist jsonb,
  done_by uuid default auth.uid() references auth.users (id),
  done_at timestamptz not null default now()
);
create index if not exists month_close_events_month_idx on public.month_close_events (month, id desc);
create index if not exists month_close_events_done_by_idx on public.month_close_events (done_by);

alter table public.month_closes enable row level security;
alter table public.month_close_events enable row level security;

-- Everyone logged in may see which months are closed (the expense form tells
-- staff before they save). Only the admin sees the history.
drop policy if exists "logged in read month closes" on public.month_closes;
create policy "logged in read month closes" on public.month_closes
  for select to authenticated using (true);
drop policy if exists "admin read month close events" on public.month_close_events;
create policy "admin read month close events" on public.month_close_events
  for select to authenticated using ((select private.is_admin()));

revoke all on public.month_closes, public.month_close_events from anon, authenticated;
grant select on public.month_closes, public.month_close_events to authenticated;

-- ---------------------------------------------------------------------------
-- Close and reopen (admin only)
-- ---------------------------------------------------------------------------
create or replace function public.close_month(p_month text, p_checklist jsonb, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select private.is_admin()) then
    raise exception 'Only an admin can close a month.' using errcode = '42501';
  end if;
  if p_month is null or p_month !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'BAD_MONTH' using errcode = '22023';
  end if;
  if p_month >= to_char(now() at time zone 'Asia/Kolkata', 'YYYY-MM') then
    raise exception 'MONTH_NOT_OVER' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.month_closes where month = p_month and closed) then
    raise exception 'ALREADY_CLOSED' using errcode = 'P0001';
  end if;
  insert into public.month_closes (month, closed, closed_by, closed_at, note, checklist)
  values (p_month, true, auth.uid(), now(), coalesce(left(p_note, 500), ''), coalesce(p_checklist, '[]'::jsonb))
  on conflict (month) do update
    set closed = true, closed_by = excluded.closed_by, closed_at = excluded.closed_at,
        note = excluded.note, checklist = excluded.checklist;
  insert into public.month_close_events (month, action, reason, checklist)
  values (p_month, 'close', coalesce(left(p_note, 500), ''), p_checklist);
end;
$$;

create or replace function public.reopen_month(p_month text, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select private.is_admin()) then
    raise exception 'Only an admin can reopen a month.' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'REASON_NEEDED' using errcode = '22023';
  end if;
  update public.month_closes
     set closed = false, reopened_by = auth.uid(), reopened_at = now(), reopen_reason = left(btrim(p_reason), 500)
   where month = p_month and closed;
  if not found then
    raise exception 'NOT_CLOSED' using errcode = 'P0001';
  end if;
  insert into public.month_close_events (month, action, reason) values (p_month, 'reopen', left(btrim(p_reason), 500));
end;
$$;

revoke execute on function public.close_month(text, jsonb, text) from public, anon;
revoke execute on function public.reopen_month(text, text) from public, anon;
grant execute on function public.close_month(text, jsonb, text) to authenticated;
grant execute on function public.reopen_month(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The lock
-- ---------------------------------------------------------------------------
create or replace function private.month_is_closed(p_month text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.month_closes where month = p_month and closed);
$$;
revoke execute on function private.month_is_closed(text) from public, anon;
grant execute on function private.month_is_closed(text) to authenticated;

-- Which month a row belongs to. TG_ARGV[0] says how to tell:
--   date:<column>   a date column          month:<column>   a YYYY-MM column
--   gap             gap_answers (PR #15): the month, or the bank row / receipt / expense it answers
--   category_change category_changes (PR #19): the expense or bank row it changed
create or replace function private.row_month(p_how text, p_row jsonb)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_key text;
begin
  if p_row is null then
    return null;
  elsif p_how like 'date:%' then
    return left(p_row ->> substr(p_how, 6), 7);
  elsif p_how like 'month:%' then
    return p_row ->> substr(p_how, 7);
  elsif p_how = 'gap' then
    v_key := p_row ->> 'item_key';
    if v_key ~ '^\d{4}-\d{2}$' then
      return v_key;
    end if;
    return coalesce(
      (select to_char(txn_date, 'YYYY-MM') from public.bank_transactions where id::text = v_key),
      (select to_char(receipt_date, 'YYYY-MM') from public.pappyjoe_receipts where id::text = v_key),
      (select to_char(date, 'YYYY-MM') from public.expenses where id::text = v_key));
  elsif p_how = 'category_change' then
    v_key := p_row ->> 'target_id';
    if p_row ->> 'target' = 'bank' then
      return (select to_char(txn_date, 'YYYY-MM') from public.bank_transactions where id::text = v_key);
    end if;
    return (select to_char(date, 'YYYY-MM') from public.expenses where id::text = v_key);
  end if;
  return null;
end;
$$;
revoke execute on function private.row_month(text, jsonb) from public, anon, authenticated;

create or replace function private.guard_closed_month()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_month text;
begin
  -- A category rename cascades into old rows: allow it when nothing but the
  -- category name changes and it comes from the rename (a nested trigger).
  if tg_op = 'UPDATE' and pg_trigger_depth() > 1 and (v_old - 'category') = (v_new - 'category') then
    return new;
  end if;
  foreach v_month in array array[private.row_month(tg_argv[0], v_old), private.row_month(tg_argv[0], v_new)] loop
    if v_month is not null and private.month_is_closed(v_month) then
      raise exception 'MONTH_CLOSED:%', v_month
        using errcode = 'P0001', hint = 'This month is closed. The admin can reopen it on the Month close page.';
    end if;
  end loop;
  return coalesce(new, old);
end;
$$;
revoke execute on function private.guard_closed_month() from public, anon, authenticated;

create or replace function private.attach_month_lock(p_table text, p_how text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if to_regclass('public.' || p_table) is null then
    return;
  end if;
  execute format('drop trigger if exists guard_closed_month on public.%I', p_table);
  execute format(
    'create trigger guard_closed_month before insert or update or delete on public.%I for each row execute function private.guard_closed_month(%L)',
    p_table, p_how);
end;
$$;
revoke execute on function private.attach_month_lock(text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Lock the tables (run this section again after any later PR's SQL)
-- ---------------------------------------------------------------------------
select private.attach_month_lock('expenses', 'date:date');
select private.attach_month_lock('bank_transactions', 'date:txn_date');
select private.attach_month_lock('pappyjoe_receipts', 'date:receipt_date');
select private.attach_month_lock('petty_cash_transfers', 'date:date');
select private.attach_month_lock('bank_deposits', 'date:date');
select private.attach_month_lock('pappyjoe_income', 'month:month');
select private.attach_month_lock('recon_notes', 'month:month');
select private.attach_month_lock('recon_reasons', 'month:month');
-- From PRs #15, #16, #18, #19 (skipped quietly if not created yet).
select private.attach_month_lock('gap_answers', 'gap');
select private.attach_month_lock('petty_cash_counts', 'month:month');
select private.attach_month_lock('import_deletions', 'month:month');
select private.attach_month_lock('category_changes', 'category_change');

-- Log closes and reopens in the activity log too, if it is set up.
do $$
begin
  if to_regprocedure('private.attach_activity_log(text, text, text)') is not null then
    perform private.attach_activity_log('month_closes', 'month', 'insert or update');
  end if;
end;
$$;
