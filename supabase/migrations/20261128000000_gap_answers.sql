-- Reconciliation answers: every gap item asks "what happened?" with a fixed
-- list of answers per kind of gap, and the admin's own answers are added to it.
--
-- * gap_reasons: the answers offered per gap type. Built-in ones carry a code
--   (lib/gaps.ts SEED_GAP_REASONS has the same rows). follow_up = something still
--   has to be fixed, and todo says what. The same text twice for one gap type
--   is refused (any case or spacing).
-- * gap_answers: the answer for one item (bank row, PappyJoe receipt, expense,
--   or a month for the cash gap). amount is the gap when answered, so a cash
--   gap that changes is asked again. signature = who sent / which patient /
--   which payee, used to suggest the same answer for the same kind of item.
-- * gap_rules: "always answer items with this signature this way".
-- All admin only.

create table public.gap_reasons (
  id uuid primary key default gen_random_uuid(),
  gap_type text not null check (gap_type in ('UPI_BANK_ONLY', 'UPI_PJ_ONLY', 'OTHER_CREDIT', 'PORTAL_ONLY', 'PJ_NEGATIVE', 'CASH_GAP')),
  code text unique,
  label text not null check (length(btrim(label)) between 3 and 120),
  follow_up boolean not null default false,
  todo text,
  active boolean not null default true,
  sort_order int not null default 100,
  created_by uuid default auth.uid() references auth.users (id),
  created_at timestamptz not null default now()
);
create unique index gap_reasons_label_unique
  on public.gap_reasons (gap_type, lower(regexp_replace(btrim(label), '\s+', ' ', 'g')));
create index gap_reasons_created_by_idx on public.gap_reasons (created_by);

create table public.gap_answers (
  id uuid primary key default gen_random_uuid(),
  gap_type text not null check (gap_type in ('UPI_BANK_ONLY', 'UPI_PJ_ONLY', 'OTHER_CREDIT', 'PORTAL_ONLY', 'PJ_NEGATIVE', 'CASH_GAP')),
  item_key text not null check (length(item_key) between 1 and 100),
  reason_id uuid not null references public.gap_reasons (id),
  note text not null default '' check (length(note) <= 500),
  amount numeric(12, 2) not null,
  signature text check (length(signature) <= 200),
  answered_by uuid default auth.uid() references auth.users (id),
  answered_at timestamptz not null default now(),
  unique (gap_type, item_key)
);
create index gap_answers_reason_idx on public.gap_answers (reason_id);
create index gap_answers_answered_by_idx on public.gap_answers (answered_by);

create table public.gap_rules (
  id uuid primary key default gen_random_uuid(),
  gap_type text not null check (gap_type in ('UPI_BANK_ONLY', 'UPI_PJ_ONLY', 'OTHER_CREDIT', 'PORTAL_ONLY', 'PJ_NEGATIVE', 'CASH_GAP')),
  signature text not null check (length(signature) between 1 and 200),
  reason_id uuid not null references public.gap_reasons (id) on delete cascade,
  created_by uuid default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  unique (gap_type, signature)
);
create index gap_rules_reason_idx on public.gap_rules (reason_id);
create index gap_rules_created_by_idx on public.gap_rules (created_by);

alter table public.gap_reasons enable row level security;
alter table public.gap_answers enable row level security;
alter table public.gap_rules enable row level security;

create policy "admin manage gap reasons" on public.gap_reasons
  for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "admin manage gap answers" on public.gap_answers
  for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "admin manage gap rules" on public.gap_rules
  for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));

insert into public.gap_reasons (code, gap_type, label, follow_up, todo, sort_order) values
  ('bank_not_entered', 'UPI_BANK_ONLY', 'Receipt was not entered in PappyJoe', true, 'Add the receipt in PappyJoe as UPI. It matches on the next import.', 1),
  ('bank_wrong_mode', 'UPI_BANK_ONLY', 'Entered in PappyJoe as cash or card, not UPI', true, 'Change the payment mode to UPI in PappyJoe.', 2),
  ('bank_wrong_amount', 'UPI_BANK_ONLY', 'Entered in PappyJoe with a different amount', true, 'Correct the amount in PappyJoe.', 3),
  ('bank_date_far', 'UPI_BANK_ONLY', 'Entered in PappyJoe on a different date', false, null, 4),
  ('bank_doctor', 'UPI_BANK_ONLY', 'Money passed on by the doctor (card or other collection)', false, null, 5),
  ('bank_not_patient', 'UPI_BANK_ONLY', 'Not patient income (refund, personal or other)', false, null, 6),
  ('pj_doctor_account', 'UPI_PJ_ONLY', 'Patient paid to the doctor''s account', true, 'Ask the doctor to transfer it to the clinic account.', 7),
  ('pj_was_cash', 'UPI_PJ_ONLY', 'Patient actually paid by cash or card', true, 'Change the payment mode in PappyJoe.', 8),
  ('pj_date_far', 'UPI_PJ_ONLY', 'Bank credit came on a different date', false, null, 9),
  ('pj_split', 'UPI_PJ_ONLY', 'Paid in parts, or as one transfer with other receipts', false, null, 10),
  ('pj_mistake', 'UPI_PJ_ONLY', 'Entered in PappyJoe by mistake', true, 'Delete or correct the receipt in PappyJoe.', 11),
  ('oc_card', 'OTHER_CREDIT', 'Card money paid in by the doctor', true, 'Mark the card payment as credited on Card income.', 12),
  ('oc_refund', 'OTHER_CREDIT', 'Refund from a supplier or vendor', false, null, 13),
  ('oc_interest', 'OTHER_CREDIT', 'Bank interest or a reversed charge', false, null, 14),
  ('oc_owner', 'OTHER_CREDIT', 'Owner''s own money put in', false, null, 15),
  ('po_other_account', 'PORTAL_ONLY', 'Paid from another account (doctor''s or personal)', false, null, 16),
  ('po_other_month', 'PORTAL_ONLY', 'Paid from the bank in a different month', false, null, 17),
  ('po_wrong_amount', 'PORTAL_ONLY', 'Amount typed differently in the portal', true, 'Correct the amount on the portal entry.', 18),
  ('po_petty', 'PORTAL_ONLY', 'Actually paid from petty cash', true, 'Change Paid by to Petty cash on the portal entry.', 19),
  ('po_not_paid', 'PORTAL_ONLY', 'Not paid yet', true, 'Check again after it is paid.', 20),
  ('neg_mode_change', 'PJ_NEGATIVE', 'Correction: the payment mode was changed', false, null, 21),
  ('neg_refund', 'PJ_NEGATIVE', 'Refund to the patient', false, null, 22),
  ('neg_cancel', 'PJ_NEGATIVE', 'Cancelled or duplicate receipt', false, null, 23),
  ('neg_ask', 'PJ_NEGATIVE', 'Not sure yet', true, 'Ask the doctor what this line means.', 24),
  ('cash_next_month', 'CASH_GAP', 'The rest was deposited early next month', false, null, 25),
  ('cash_prev_month', 'CASH_GAP', 'Includes last month''s cash deposited this month', false, null, 26),
  ('cash_with_doctor', 'CASH_GAP', 'Cash is still with the doctor or at the clinic', true, 'Deposit it in the HDFC account.', 27),
  ('cash_mode_wrong', 'CASH_GAP', 'Some cash receipts were really UPI or card', true, 'Fix the payment mode in PappyJoe.', 28)
on conflict (code) do nothing;
