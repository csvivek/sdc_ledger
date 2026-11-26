-- SDC Ledger: treat Pharma like Lab. Pharma expenses ask which pharmacy or
-- supplier (from the payees list) and need the invoice number.
-- Runs after 20261125130000_invoice_categories.sql.
--
-- A new enum value cannot be used in the same transaction that adds it, so
-- this runs in two steps. If you paste it into the SQL editor, run step 1,
-- then step 2.

-- Step 1
alter type public.payee_kind add value if not exists 'pharma' after 'lab';

-- Step 2
update public.categories set payee_kind = 'pharma', needs_invoice = true where name = 'Pharma';
