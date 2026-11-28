-- Staff petty cash balance (new navigation, 2026-11-28).
--
-- Staff may see their own clinic's petty cash balance, and nothing else from
-- petty cash, the bank or the P&L. Staff cannot read bank transactions,
-- petty cash transfers, counts or other people's expenses (row level
-- security), so this read-only function returns just the figures the app
-- needs to work out the balance, for the caller's own clinic only.
--
-- It returns null for a switched-off login or one with no clinic. Bank rows
-- come back as date + amount of the PETTY CASH withdrawals only (split between
-- the clinics by the app), with no narration or other bank data.
--
-- Safe to run more than once.

create or replace function public.my_petty_cash()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select p.clinic
    from public.profiles p
    where p.id = auth.uid()
      and p.active
      and p.clinic in ('SDC1', 'SDC2')
  )
  select case when not exists (select 1 from me) then null else jsonb_build_object(
    'clinic', (select clinic from me),
    'opening', (select c.petty_cash_opening from public.clinics c where c.id = (select clinic from me)),
    'transfers', coalesce((
      select jsonb_agg(jsonb_build_object('date', t.date, 'amount', t.amount))
      from public.petty_cash_transfers t
      where t.clinic = (select clinic from me)
    ), '[]'::jsonb),
    'bank', coalesce((
      select jsonb_agg(jsonb_build_object('date', b.txn_date, 'withdrawal', b.withdrawal))
      from public.bank_transactions b
      where b.kind = 'PETTY_CASH'
    ), '[]'::jsonb),
    'spent', coalesce((
      select jsonb_agg(jsonb_build_object('date', e.date, 'amount', e.amount))
      from public.expenses e
      where e.paid_by = 'PETTY_CASH' and e.petty_cash_clinic = (select clinic from me)
    ), '[]'::jsonb),
    'counts', coalesce((
      select jsonb_agg(jsonb_build_object('month', k.month, 'counted', k.counted))
      from public.petty_cash_counts k
      where k.clinic = (select clinic from me)
    ), '[]'::jsonb)
  ) end;
$$;

revoke all on function public.my_petty_cash() from public, anon;
grant execute on function public.my_petty_cash() to authenticated;
