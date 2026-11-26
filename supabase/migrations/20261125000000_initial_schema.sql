-- SDC Ledger: initial schema.
--
-- Run this once in the Supabase dashboard: SQL Editor > New query > paste this
-- whole file > Run. It is safe to read top to bottom; nothing here deletes data.
--
-- Access rules (row level security):
--   * admin: reads and writes everything.
--   * staff: reads clinics, categories and their own profile; adds expenses;
--            reads only the expenses they entered themselves.
--   * not logged in: nothing.
-- New sign-ups get the "staff" role. Make someone admin with:
--   update public.profiles set role = 'admin' where email = 'someone@example.com';

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type public.user_role as enum ('admin', 'staff');
create type public.paid_by as enum ('PETTY_CASH', 'UPI', 'BANK');
create type public.deposit_kind as enum ('CASH', 'UPI', 'CARD');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.clinics (
  id text primary key check (id in ('SDC1', 'SDC2')),
  name text not null,
  petty_cash_opening numeric(12, 2) not null default 0
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  name text not null,
  role public.user_role not null default 'staff',
  clinic text references public.clinics (id),
  created_at timestamptz not null default now()
);

create table public.categories (
  name text primary key,
  sort_order int not null default 0,
  active boolean not null default true
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  amount numeric(12, 2) not null check (amount > 0),
  category text not null references public.categories (name) on update cascade,
  clinic text not null check (clinic in ('SDC1', 'SDC2', 'SHARED')),
  paid_by public.paid_by not null,
  petty_cash_clinic text references public.clinics (id),
  note text not null default '',
  entered_by uuid not null default auth.uid() references auth.users (id),
  entered_at timestamptz not null default now(),
  check (paid_by <> 'PETTY_CASH' or petty_cash_clinic is not null)
);
create index expenses_date_idx on public.expenses (date);
create index expenses_entered_by_idx on public.expenses (entered_by);

-- Cash moved from the shared bank account into a clinic's petty cash box.
-- A transfer, not an expense.
create table public.petty_cash_transfers (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  clinic text not null references public.clinics (id),
  amount numeric(12, 2) not null check (amount > 0),
  note text not null default '',
  created_at timestamptz not null default now()
);

-- Monthly totals per clinic from the PappyJoe Excel export.
create table public.pappyjoe_income (
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  clinic text not null references public.clinics (id),
  cash numeric(12, 2) not null default 0,
  upi numeric(12, 2) not null default 0,
  card numeric(12, 2) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (month, clinic)
);

-- Credits into the shared HDFC account, tagged to a clinic.
create table public.bank_deposits (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  clinic text not null references public.clinics (id),
  kind public.deposit_kind not null,
  amount numeric(12, 2) not null check (amount > 0),
  narration text not null default '',
  created_at timestamptz not null default now()
);
create index bank_deposits_date_idx on public.bank_deposits (date);

-- Admin's explanation for a PappyJoe vs bank gap.
create table public.recon_reasons (
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  clinic text not null references public.clinics (id),
  reason text not null,
  updated_at timestamptz not null default now(),
  primary key (month, clinic)
);

-- Card payments collected by the doctor that must reach the clinic account.
create table public.card_payments (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  clinic text not null references public.clinics (id),
  patient_ref text not null default '',
  amount numeric(12, 2) not null check (amount > 0),
  credited_on date,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Starting data
-- ---------------------------------------------------------------------------
insert into public.clinics (id, name) values
  ('SDC1', 'SDC 1 · Podanur'),
  ('SDC2', 'SDC 2 · Malumichampatti');

insert into public.categories (name, sort_order) values
  ('Salary', 1), ('Rent', 2), ('EB (electricity)', 3), ('Flowers', 4),
  ('Lab', 5), ('Pharma', 6), ('Consultant', 7), ('Dental materials', 8),
  ('Marketing', 9), ('Bank charges', 10), ('Miscellaneous', 11);

-- ---------------------------------------------------------------------------
-- Profiles are created automatically for every new login
-- ---------------------------------------------------------------------------
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, name)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data ->> 'name', ''), split_part(coalesce(new.email, ''), '@', 1), 'User')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- True when the logged-in user is an admin. security definer so it can read
-- profiles without tripping the profiles policies.
create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  );
$$;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.clinics enable row level security;
alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.expenses enable row level security;
alter table public.petty_cash_transfers enable row level security;
alter table public.pappyjoe_income enable row level security;
alter table public.bank_deposits enable row level security;
alter table public.recon_reasons enable row level security;
alter table public.card_payments enable row level security;

-- Clinics and categories: everyone logged in can read; admin manages.
create policy "logged in read clinics" on public.clinics
  for select to authenticated using (true);
create policy "admin manage clinics" on public.clinics
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "logged in read categories" on public.categories
  for select to authenticated using (true);
create policy "admin manage categories" on public.categories
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Profiles: you can read your own; admin reads and edits all. Staff cannot
-- change their own role because there is no update policy for them.
create policy "read own profile" on public.profiles
  for select to authenticated using (id = auth.uid());
create policy "admin manage profiles" on public.profiles
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Expenses: anyone logged in can add one in their own name and see their own;
-- only admin sees all, edits or deletes.
create policy "add own expenses" on public.expenses
  for insert to authenticated with check (entered_by = auth.uid());
create policy "read own expenses" on public.expenses
  for select to authenticated using (entered_by = auth.uid());
create policy "admin manage expenses" on public.expenses
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Everything else is admin only.
create policy "admin manage petty cash transfers" on public.petty_cash_transfers
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin manage pappyjoe income" on public.pappyjoe_income
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin manage bank deposits" on public.bank_deposits
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin manage recon reasons" on public.recon_reasons
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin manage card payments" on public.card_payments
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Let logged-in users reach these tables through the Supabase API. The
-- policies above still decide which rows they see or change.
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on function public.is_admin() to authenticated;
