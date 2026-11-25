-- SDC Ledger: import HDFC statements and PappyJoe payment exports, and
-- reconcile them. Runs after 20261125150000_dental_suppliers.sql.
-- Adds tables only (plus two categories and a column); nothing existing is
-- changed or deleted. Everything here is admin only.
--
-- * import_batches: one row per uploaded file.
-- * bank_transactions: every HDFC row, with what the app decided it is
--   (kind / category / clinic). fingerprint stops a re-upload adding rows twice.
-- * bank_rules: "narration contains X -> category Y". Seeded from the labelled
--   October 2026 statement; the admin's answers add more.
-- * pappyjoe_receipts: every line of a PappyJoe Payments export, per clinic.
-- * recon_notes: the admin's explanation per month and topic (UPI, cash...).
-- * card_payments.pappyjoe_receipt_id: card payments now come from the import.

insert into public.categories (name, sort_order) values
  ('Biowaste', 12),
  ('Dental chair service', 13)
on conflict (name) do nothing;

create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('HDFC', 'PAPPYJOE')),
  clinic text references public.clinics (id),
  file_name text not null default '',
  first_date date,
  last_date date,
  rows_read int not null default 0,
  rows_added int not null default 0,
  imported_by uuid not null default auth.uid() references auth.users (id),
  imported_at timestamptz not null default now()
);
create index import_batches_imported_by_idx on public.import_batches (imported_by);

create table public.bank_rules (
  id uuid primary key default gen_random_uuid(),
  pattern text not null check (length(btrim(pattern)) between 2 and 200),
  match_type text not null default 'contains' check (match_type in ('contains', 'regex')),
  action text not null check (action in ('EXPENSE', 'PETTY_CASH', 'TRANSFER_OUT')),
  category text references public.categories (name) on update cascade,
  clinic text check (clinic in ('SDC1', 'SDC2', 'SHARED')),
  priority int not null default 50,
  created_by uuid default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  check ((action = 'EXPENSE') = (category is not null))
);
create index bank_rules_category_idx on public.bank_rules (category);
create index bank_rules_created_by_idx on public.bank_rules (created_by);

create table public.bank_transactions (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid references public.import_batches (id) on delete set null,
  txn_date date not null,
  narration text not null,
  ref_no text not null default '',
  value_date date,
  withdrawal numeric(12, 2) not null default 0 check (withdrawal >= 0),
  deposit numeric(12, 2) not null default 0 check (deposit >= 0),
  closing_balance numeric(14, 2),
  kind text not null check (kind in ('UPI_IN', 'CASH_DEPOSIT', 'OTHER_IN', 'EXPENSE', 'PETTY_CASH', 'TRANSFER_OUT', 'UNKNOWN_OUT')),
  category text references public.categories (name) on update cascade,
  clinic text check (clinic in ('SDC1', 'SDC2', 'SHARED')),
  rule_id uuid references public.bank_rules (id) on delete set null,
  fingerprint text not null unique,
  created_at timestamptz not null default now(),
  check ((withdrawal > 0) <> (deposit > 0)),
  check ((kind = 'EXPENSE') = (category is not null))
);
create index bank_transactions_date_idx on public.bank_transactions (txn_date);
create index bank_transactions_batch_idx on public.bank_transactions (batch_id);
create index bank_transactions_category_idx on public.bank_transactions (category);
create index bank_transactions_rule_idx on public.bank_transactions (rule_id);

create table public.pappyjoe_receipts (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid references public.import_batches (id) on delete set null,
  clinic text not null references public.clinics (id),
  receipt_date date not null,
  patient_name text not null default '',
  patient_id text not null default '',
  receipt_no text not null,
  invoice_no text not null default '',
  invoice_total numeric(12, 2) not null default 0,
  amount numeric(12, 2) not null,
  mode text not null check (mode in ('CASH', 'UPI', 'CARD', 'OTHER')),
  payment_info text not null default '',
  receipt_by text not null default '',
  created_at timestamptz not null default now(),
  unique (clinic, receipt_no)
);
create index pappyjoe_receipts_date_idx on public.pappyjoe_receipts (receipt_date);
create index pappyjoe_receipts_batch_idx on public.pappyjoe_receipts (batch_id);

create table public.recon_notes (
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  topic text not null check (topic in ('UPI', 'CASH', 'CARD', 'EXPENSES')),
  note text not null,
  updated_at timestamptz not null default now(),
  primary key (month, topic)
);

alter table public.card_payments
  add column pappyjoe_receipt_id uuid unique references public.pappyjoe_receipts (id) on delete cascade;

-- Starting rules (from the PURPOSE column Vivek's team filled in for Oct 2026).
insert into public.bank_rules (pattern, match_type, action, category, priority, created_by) values
  ('TPT-PETTY CASH', 'contains', 'PETTY_CASH', null, 10, null),
  ('BIOWASTE', 'contains', 'EXPENSE', 'Biowaste', 20, null),
  ('TNPDCL', 'contains', 'EXPENSE', 'EB (electricity)', 20, null),
  ('ZAHN ARTZ', 'contains', 'EXPENSE', 'Lab', 20, null),
  ('RUPAY MDR', 'contains', 'EXPENSE', 'Bank charges', 20, null),
  ('SOUND BOX RENTAL', 'contains', 'EXPENSE', 'Bank charges', 20, null),
  ('CHAIR (REPAIR|SERVICE)|COMPRESSOR REPAIR', 'regex', 'EXPENSE', 'Dental chair service', 30, null),
  ('FLOWERS', 'contains', 'EXPENSE', 'Flowers', 30, null),
  ('SDC ?[12]? ?SAL\b|-SAL$', 'regex', 'EXPENSE', 'Salary', 40, null),
  ('-RENT$', 'regex', 'EXPENSE', 'Rent', 40, null),
  ('\bCONS(ULTANT)?\b', 'regex', 'EXPENSE', 'Consultant', 40, null),
  ('-LAB$', 'regex', 'EXPENSE', 'Lab', 40, null);

-- Row level security: admin only.
alter table public.import_batches enable row level security;
alter table public.bank_rules enable row level security;
alter table public.bank_transactions enable row level security;
alter table public.pappyjoe_receipts enable row level security;
alter table public.recon_notes enable row level security;

create policy "admin manage import batches" on public.import_batches
  for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "admin manage bank rules" on public.bank_rules
  for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "admin manage bank transactions" on public.bank_transactions
  for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "admin manage pappyjoe receipts" on public.pappyjoe_receipts
  for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "admin manage recon notes" on public.recon_notes
  for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));

revoke all on public.import_batches, public.bank_rules, public.bank_transactions, public.pappyjoe_receipts, public.recon_notes from anon;
grant select, insert, update, delete on public.import_batches, public.bank_rules, public.bank_transactions, public.pappyjoe_receipts, public.recon_notes to authenticated;
