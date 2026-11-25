-- SDC Ledger: who an expense was paid to, lab invoice numbers, and whether the
-- entry is already in PappyJoe. Runs after 20261125100000_security_hardening.sql.
--
-- * payees: one list of names, each tagged staff, lab or consultant. Anyone
--   logged in can read it (to fill the dropdown) and add a new name from the
--   entry form. Only admin can rename, hide or delete a name.
-- * categories.payee_kind: which kind of payee a category asks for
--   (Salary -> staff, Lab -> lab, Consultant -> consultant).
-- * expenses.payee_id, lab_invoice_no, in_pappyjoe: the new answers.
--   The rules are enforced for new and edited rows only, so the expenses that
--   were saved before this migration stay valid.

create type public.payee_kind as enum ('staff', 'lab', 'consultant');
create type public.pappyjoe_status as enum ('YES', 'NO', 'NA');

create table public.payees (
  id uuid primary key default gen_random_uuid(),
  kind public.payee_kind not null,
  name text not null check (length(btrim(name)) between 1 and 100),
  active boolean not null default true,
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now()
);
create unique index payees_kind_name_key on public.payees (kind, lower(btrim(name)));
create index payees_created_by_idx on public.payees (created_by);

alter table public.categories add column payee_kind public.payee_kind;
update public.categories set payee_kind = 'staff' where name = 'Salary';
update public.categories set payee_kind = 'lab' where name = 'Lab';
update public.categories set payee_kind = 'consultant' where name = 'Consultant';

alter table public.expenses
  add column payee_id uuid references public.payees (id),
  add column lab_invoice_no text,
  add column in_pappyjoe public.pappyjoe_status;
create index expenses_payee_id_idx on public.expenses (payee_id);

-- Every new entry must answer the PappyJoe question. NOT VALID keeps the
-- older rows as they are.
alter table public.expenses
  add constraint expenses_in_pappyjoe_required check (in_pappyjoe is not null) not valid;

-- Payee and lab invoice rules depend on the category, so a trigger checks them.
create function private.check_expense_payee()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  want public.payee_kind;
  got public.payee_kind;
begin
  select c.payee_kind into want from public.categories c where c.name = new.category;
  if new.payee_id is not null then
    select p.kind into got from public.payees p where p.id = new.payee_id;
  end if;

  if want is null then
    if new.payee_id is not null then
      raise exception 'Category % does not take a payee', new.category;
    end if;
  else
    if got is distinct from want then
      raise exception 'Category % needs a % name', new.category, want;
    end if;
  end if;

  if want = 'lab' and coalesce(btrim(new.lab_invoice_no), '') = '' then
    raise exception 'Lab expenses need the lab invoice number';
  end if;
  if want is distinct from 'lab' then
    new.lab_invoice_no := null;
  end if;
  return new;
end;
$$;
revoke execute on function private.check_expense_payee() from public, anon, authenticated;

create trigger expenses_check_payee
  before insert or update of category, payee_id, lab_invoice_no on public.expenses
  for each row execute function private.check_expense_payee();

-- Row level security for payees.
alter table public.payees enable row level security;

create policy "logged in read payees" on public.payees
  for select to authenticated using (true);
create policy "add payees" on public.payees
  for insert to authenticated
  with check (created_by = (select auth.uid()) or (select private.is_admin()));
create policy "admin update payees" on public.payees
  for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "admin delete payees" on public.payees
  for delete to authenticated using ((select private.is_admin()));

revoke all on public.payees from anon;
grant select, insert, update, delete on public.payees to authenticated;
