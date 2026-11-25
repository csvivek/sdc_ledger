# SDC Ledger

Expense and income tracking for **Sarada Dental Care**, covering both clinics:

- **SDC 1** – Podanur
- **SDC 2** – Malumichampatti

## Purpose

SDC Ledger replaces the monthly Excel workbook with a simple web app that:

- Lets the doctor and staff record daily expenses from a phone.
- Brings in income from PappyJoe (the clinic management software) and the HDFC bank statement.
- Reconciles PappyJoe income against bank deposits weekly and monthly, with reasons for any gaps.
- Sorts bank debits into expense categories.
- Flags card income that still has to reach the clinic bank account by month end.
- Keeps separate books for each clinic, with a combined view and a consolidated P&L trend.

## Planned stack

- **Web app:** Next.js
- **Database:** Supabase Postgres
- **Login:** Supabase Auth (admin sees everything; other users can only enter data)
- **File storage:** Supabase Storage (bank statements, PappyJoe exports, receipts)

## Status

Requirements are awaiting the doctor's sign-off. No application code has been written yet.
