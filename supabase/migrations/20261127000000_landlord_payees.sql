-- SDC Ledger: a "landlord / vendor" payee type, for people and businesses we
-- pay that are not staff, labs, consultants or suppliers (e.g. the SDC1
-- landlord, biowaste collection, chair repair). Payees only: no expense
-- category is tied to this type, because the same person can be paid for
-- other reasons too.
alter type public.payee_kind add value if not exists 'landlord' after 'consultant';
