-- Safer imports (Vivek, 2026-11-27).
--
-- 1. import_bank_file / import_pappyjoe_file: save one uploaded file in a
--    single transaction. The import record, every row and the card payments
--    made from PappyJoe card receipts are written together or not at all, so a
--    failure half way can never leave part of a file in the ledger.
-- 2. delete_imported_month: removes the imported bank rows for one month, or
--    the PappyJoe receipts for one clinic and month (with the pending card
--    payments made from them), in one transaction, and writes a line to
--    import_deletions saying who removed what. It never touches portal
--    expenses, payees, categories, bank rules, reconciliation notes or petty
--    cash. It refuses when a card payment from that month is already marked as
--    credited, because deleting it would lose that answer.
-- 3. A private, admin-only storage bucket keeps the original uploaded file;
--    import_batches.file_path points at it.
--
-- All functions are security invoker: they run as the logged-in user, so row
-- level security (admin only) applies as well as the explicit check.

alter table public.import_batches add column file_path text;

-- ---------------------------------------------------------------------------
-- Import one HDFC statement
-- ---------------------------------------------------------------------------
create function public.import_bank_file(p_batch jsonb, p_rows jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_batch uuid;
  v_added int;
begin
  if not (select private.is_admin()) then
    raise exception 'Only an admin can import files.' using errcode = '42501';
  end if;

  insert into public.import_batches (source, file_name, file_path, rows_read, first_date, last_date)
  values (
    'HDFC',
    coalesce(p_batch ->> 'file_name', ''),
    p_batch ->> 'file_path',
    jsonb_array_length(p_rows),
    (p_batch ->> 'first_date')::date,
    (p_batch ->> 'last_date')::date
  )
  returning id into v_batch;

  with ins as (
    insert into public.bank_transactions
      (batch_id, txn_date, narration, ref_no, value_date, withdrawal, deposit, closing_balance, kind, category, clinic, rule_id, fingerprint)
    select v_batch, r.txn_date, r.narration, coalesce(r.ref_no, ''), r.value_date, r.withdrawal, r.deposit, r.closing_balance,
           r.kind, r.category, r.clinic, r.rule_id, r.fingerprint
    from jsonb_to_recordset(p_rows) as r(
      txn_date date, narration text, ref_no text, value_date date, withdrawal numeric, deposit numeric,
      closing_balance numeric, kind text, category text, clinic text, rule_id uuid, fingerprint text)
    on conflict (fingerprint) do nothing
    returning 1
  )
  select count(*) into v_added from ins;

  update public.import_batches set rows_added = v_added where id = v_batch;
  return jsonb_build_object('batch_id', v_batch, 'added', v_added);
end;
$$;

-- ---------------------------------------------------------------------------
-- Import one PappyJoe Payments export (one clinic)
-- ---------------------------------------------------------------------------
create function public.import_pappyjoe_file(p_batch jsonb, p_rows jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_batch uuid;
  v_clinic text := p_batch ->> 'clinic';
  v_added int;
  v_cards int;
begin
  if not (select private.is_admin()) then
    raise exception 'Only an admin can import files.' using errcode = '42501';
  end if;
  if v_clinic is null or v_clinic not in ('SDC1', 'SDC2') then
    raise exception 'A PappyJoe import needs a clinic.' using errcode = '22023';
  end if;

  insert into public.import_batches (source, clinic, file_name, file_path, rows_read, first_date, last_date)
  values (
    'PAPPYJOE',
    v_clinic,
    coalesce(p_batch ->> 'file_name', ''),
    p_batch ->> 'file_path',
    jsonb_array_length(p_rows),
    (p_batch ->> 'first_date')::date,
    (p_batch ->> 'last_date')::date
  )
  returning id into v_batch;

  with ins as (
    insert into public.pappyjoe_receipts
      (batch_id, clinic, receipt_date, patient_name, patient_id, receipt_no, invoice_no, invoice_total, amount, mode, payment_info, receipt_by)
    select v_batch, v_clinic, r.receipt_date, coalesce(r.patient_name, ''), coalesce(r.patient_id, ''), r.receipt_no,
           coalesce(r.invoice_no, ''), coalesce(r.invoice_total, 0), r.amount, r.mode, coalesce(r.payment_info, ''), coalesce(r.receipt_by, '')
    from jsonb_to_recordset(p_rows) as r(
      receipt_date date, patient_name text, patient_id text, receipt_no text, invoice_no text, invoice_total numeric,
      amount numeric, mode text, payment_info text, receipt_by text)
    on conflict (clinic, receipt_no) do nothing
    returning id, receipt_date, patient_name, receipt_no, amount, mode
  ),
  cards as (
    insert into public.card_payments (date, clinic, patient_ref, amount, pappyjoe_receipt_id)
    select i.receipt_date, v_clinic, i.patient_name || ' · receipt ' || i.receipt_no, i.amount, i.id
    from ins i
    where i.mode = 'CARD' and i.amount > 0
    returning 1
  )
  select (select count(*) from ins), (select count(*) from cards) into v_added, v_cards;

  update public.import_batches set rows_added = v_added where id = v_batch;
  return jsonb_build_object('batch_id', v_batch, 'added', v_added, 'cards_added', v_cards);
end;
$$;

-- ---------------------------------------------------------------------------
-- Delete the imported data for one month
-- ---------------------------------------------------------------------------
create table public.import_deletions (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('HDFC', 'PAPPYJOE')),
  clinic text references public.clinics (id),
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  rows_deleted int not null,
  cards_deleted int not null default 0,
  money_in numeric(14, 2) not null default 0,
  money_out numeric(14, 2) not null default 0,
  first_date date,
  last_date date,
  deleted_by uuid not null default auth.uid() references auth.users (id),
  deleted_at timestamptz not null default now(),
  check ((source = 'PAPPYJOE') = (clinic is not null))
);
create index import_deletions_deleted_by_idx on public.import_deletions (deleted_by);
create index import_deletions_clinic_idx on public.import_deletions (clinic);

alter table public.import_deletions enable row level security;
create policy "admin manage import deletions" on public.import_deletions
  for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
revoke all on public.import_deletions from anon;
grant select, insert on public.import_deletions to authenticated;

create function public.delete_imported_month(p_source text, p_clinic text, p_month text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_from date;
  v_to date;
  v_rows int;
  v_cards int := 0;
  v_credited int;
  v_in numeric;
  v_out numeric;
  v_first date;
  v_last date;
begin
  if not (select private.is_admin()) then
    raise exception 'Only an admin can delete imported data.' using errcode = '42501';
  end if;
  if p_month is null or p_month !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'BAD_MONTH' using errcode = '22023';
  end if;
  v_from := (p_month || '-01')::date;
  v_to := (v_from + interval '1 month')::date;

  if p_source = 'HDFC' and p_clinic is null then
    select count(*), coalesce(sum(deposit), 0), coalesce(sum(withdrawal), 0), min(txn_date), max(txn_date)
      into v_rows, v_in, v_out, v_first, v_last
      from public.bank_transactions
      where txn_date >= v_from and txn_date < v_to;
    if v_rows = 0 then
      raise exception 'NOTHING_TO_DELETE' using errcode = 'P0002';
    end if;
    delete from public.bank_transactions where txn_date >= v_from and txn_date < v_to;

  elsif p_source = 'PAPPYJOE' and p_clinic in ('SDC1', 'SDC2') then
    select count(*) into v_credited
      from public.card_payments c
      join public.pappyjoe_receipts r on r.id = c.pappyjoe_receipt_id
      where r.clinic = p_clinic and r.receipt_date >= v_from and r.receipt_date < v_to and c.credited_on is not null;
    if v_credited > 0 then
      raise exception 'CREDITED_CARDS:%', v_credited using errcode = 'P0001';
    end if;
    select count(*), coalesce(sum(amount) filter (where amount > 0), 0), coalesce(-sum(amount) filter (where amount < 0), 0),
           min(receipt_date), max(receipt_date)
      into v_rows, v_in, v_out, v_first, v_last
      from public.pappyjoe_receipts
      where clinic = p_clinic and receipt_date >= v_from and receipt_date < v_to;
    if v_rows = 0 then
      raise exception 'NOTHING_TO_DELETE' using errcode = 'P0002';
    end if;
    select count(*) into v_cards
      from public.card_payments c
      join public.pappyjoe_receipts r on r.id = c.pappyjoe_receipt_id
      where r.clinic = p_clinic and r.receipt_date >= v_from and r.receipt_date < v_to;
    -- card_payments made from these receipts go with them (on delete cascade).
    delete from public.pappyjoe_receipts where clinic = p_clinic and receipt_date >= v_from and receipt_date < v_to;

  else
    raise exception 'BAD_SOURCE' using errcode = '22023';
  end if;

  insert into public.import_deletions (source, clinic, month, rows_deleted, cards_deleted, money_in, money_out, first_date, last_date)
  values (p_source, p_clinic, p_month, v_rows, v_cards, v_in, v_out, v_first, v_last);

  return jsonb_build_object('rows_deleted', v_rows, 'cards_deleted', v_cards, 'money_in', v_in, 'money_out', v_out);
end;
$$;

revoke execute on function public.import_bank_file(jsonb, jsonb) from public, anon;
revoke execute on function public.import_pappyjoe_file(jsonb, jsonb) from public, anon;
revoke execute on function public.delete_imported_month(text, text, text) from public, anon;
grant execute on function public.import_bank_file(jsonb, jsonb) to authenticated;
grant execute on function public.import_pappyjoe_file(jsonb, jsonb) to authenticated;
grant execute on function public.delete_imported_month(text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Private bucket for the original files (admin only, 5 MB, Excel only)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'import-files',
  'import-files',
  false,
  5242880,
  array['application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
)
on conflict (id) do nothing;

create policy "admin read import files" on storage.objects
  for select to authenticated using (bucket_id = 'import-files' and (select private.is_admin()));
create policy "admin add import files" on storage.objects
  for insert to authenticated with check (bucket_id = 'import-files' and (select private.is_admin()));
create policy "admin remove import files" on storage.objects
  for delete to authenticated using (bucket_id = 'import-files' and (select private.is_admin()));
