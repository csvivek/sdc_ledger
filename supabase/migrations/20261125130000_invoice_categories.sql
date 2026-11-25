-- SDC Ledger: ask for an invoice number on more categories than Lab.
-- Runs after 20261125120000_expense_payees.sql.
--
-- * categories.needs_invoice: when true, the expense form asks for the
--   invoice number and it is required. Lab and Dental materials to start;
--   admin can switch it on for another category with one update.
-- * expenses.lab_invoice_no is renamed to invoice_no, since it is no longer
--   only for labs.

alter table public.categories add column needs_invoice boolean not null default false;
update public.categories set needs_invoice = true where name in ('Lab', 'Dental materials');

alter table public.expenses rename column lab_invoice_no to invoice_no;

create or replace function private.check_expense_payee()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  want public.payee_kind;
  got public.payee_kind;
  invoice boolean;
begin
  select c.payee_kind, c.needs_invoice into want, invoice
    from public.categories c where c.name = new.category;
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

  if coalesce(invoice, false) then
    if coalesce(btrim(new.invoice_no), '') = '' then
      raise exception 'Category % needs the invoice number', new.category;
    end if;
  else
    new.invoice_no := null;
  end if;
  return new;
end;
$$;
revoke execute on function private.check_expense_payee() from public, anon, authenticated;

drop trigger expenses_check_payee on public.expenses;
create trigger expenses_check_payee
  before insert or update of category, payee_id, invoice_no on public.expenses
  for each row execute function private.check_expense_payee();
