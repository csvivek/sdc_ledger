-- One-tap recurring expenses (feature 6 of the admin tools PR).
--
-- Safe to run more than once.
--
-- * recurring_templates: the admin's list of monthly expenses (rent, salaries,
--   EB...): what it is, who is paid, which clinic, how it is paid, the usual
--   amount and the usual day of the month. Admin only.
-- * expenses.recurring_template_id / recurring_month: an expense added from a
--   template remembers which template and month it was for. A unique index
--   makes a second one for the same template and month impossible, even if
--   two people tap at once. It is a normal expense in every other way, so it
--   matches the bank debit through the usual reconciliation.

create table if not exists public.recurring_templates (
  id uuid primary key default gen_random_uuid(),
  label text not null check (length(btrim(label)) between 2 and 80),
  category text not null references public.categories (name) on update cascade,
  payee_id uuid references public.payees (id),
  clinic text not null check (clinic in ('SDC1', 'SDC2', 'SHARED')),
  paid_by public.paid_by not null,
  petty_cash_clinic text references public.clinics (id),
  amount numeric(12, 2) not null check (amount > 0),
  day_of_month int not null check (day_of_month between 1 and 31),
  note text not null default '' check (length(note) <= 200),
  active boolean not null default true,
  sort_order int not null default 100,
  created_by uuid default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  check (paid_by <> 'PETTY_CASH' or petty_cash_clinic is not null)
);
create unique index if not exists recurring_templates_label_unique
  on public.recurring_templates (lower(regexp_replace(btrim(label), '\s+', ' ', 'g')));
create index if not exists recurring_templates_category_idx on public.recurring_templates (category);
create index if not exists recurring_templates_payee_idx on public.recurring_templates (payee_id);
create index if not exists recurring_templates_created_by_idx on public.recurring_templates (created_by);

alter table public.recurring_templates enable row level security;
drop policy if exists "admin manage recurring templates" on public.recurring_templates;
create policy "admin manage recurring templates" on public.recurring_templates
  for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
revoke all on public.recurring_templates from anon;
grant select, insert, update, delete on public.recurring_templates to authenticated;

alter table public.expenses add column if not exists recurring_template_id uuid references public.recurring_templates (id) on delete set null;
alter table public.expenses add column if not exists recurring_month text check (recurring_month ~ '^\d{4}-(0[1-9]|1[0-2])$');
create unique index if not exists expenses_recurring_once
  on public.expenses (recurring_template_id, recurring_month)
  where recurring_template_id is not null;

-- Log template changes in the activity log too, if it is set up.
do $$
begin
  if to_regprocedure('private.attach_activity_log(text, text, text)') is not null then
    perform private.attach_activity_log('recurring_templates');
  end if;
end;
$$;
