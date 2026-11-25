-- SDC Ledger: Dental materials expenses also ask which supplier (from the
-- payees list), on top of the invoice number.
-- Runs after 20261125140000_pharma_payees.sql. Two steps, like the pharma one.

-- Step 1
alter type public.payee_kind add value if not exists 'supplier' after 'pharma';

-- Step 2
update public.categories set payee_kind = 'supplier', needs_invoice = true where name = 'Dental materials';
