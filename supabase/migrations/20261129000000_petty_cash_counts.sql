-- Month-end petty cash counts. Leftover petty cash stays in each clinic's box,
-- so once a month the admin counts it and types the amount in.
--
-- * petty_count_reasons: answers offered when the count differs from what the
--   app expected. Built-in ones carry a code (lib/petty.ts SEED_PETTY_REASONS
--   has the same rows); answers the admin types are added. The same text twice
--   is refused (any case or spacing).
-- * petty_cash_counts: one count per clinic per month. The counted amount is
--   what the next month starts with. The difference from the expected balance
--   is not stored: the app works it out from the transfers and expenses, so an
--   expense entered later for that month changes it.
-- Both admin only, like the Petty cash page.
--
-- Kept apart from the reconciliation answer tables (gap_reasons, PR #15), which
-- are not merged yet and only allow their own gap types.

create table public.petty_count_reasons (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  label text not null check (length(btrim(label)) between 3 and 120),
  active boolean not null default true,
  sort_order int not null default 100,
  created_by uuid default auth.uid() references auth.users (id),
  created_at timestamptz not null default now()
);
create unique index petty_count_reasons_label_unique
  on public.petty_count_reasons (lower(regexp_replace(btrim(label), '\s+', ' ', 'g')));
create index petty_count_reasons_created_by_idx on public.petty_count_reasons (created_by);

create table public.petty_cash_counts (
  id uuid primary key default gen_random_uuid(),
  clinic text not null references public.clinics (id),
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  counted numeric(12, 2) not null check (counted >= 0),
  reason_id uuid references public.petty_count_reasons (id),
  note text not null default '' check (length(note) <= 500),
  counted_by uuid default auth.uid() references auth.users (id),
  counted_at timestamptz not null default now(),
  unique (clinic, month)
);
create index petty_cash_counts_reason_idx on public.petty_cash_counts (reason_id);
create index petty_cash_counts_counted_by_idx on public.petty_cash_counts (counted_by);

alter table public.petty_count_reasons enable row level security;
alter table public.petty_cash_counts enable row level security;

create policy "admin manage petty count reasons" on public.petty_count_reasons
  for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "admin manage petty cash counts" on public.petty_cash_counts
  for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));

insert into public.petty_count_reasons (code, label, sort_order) values
  ('pc_not_entered', 'An expense was paid but not entered in the portal yet', 1),
  ('pc_wrong_entry', 'An expense was entered twice or with the wrong amount', 2),
  ('pc_other_clinic', 'Paid from the other clinic''s petty cash', 3),
  ('pc_advance', 'Cash given as a staff advance or loan', 4),
  ('pc_patient_cash', 'Patient cash got mixed with petty cash', 5),
  ('pc_not_split', 'A withdrawal was not split equally between the clinics', 6),
  ('pc_miscount', 'Counting mistake (this count or the last one)', 7),
  ('pc_not_sure', 'Not sure yet', 8)
on conflict (code) do nothing;
