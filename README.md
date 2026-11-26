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

A clickable **prototype** with fake data is in this repo, to show the doctor. It is not connected to PappyJoe, HDFC or Supabase.

### Run the prototype

```bash
npm install
npm run dev
```

Open http://localhost:3000 and pick a user on the login page (no password):

- **Doctor (Admin)** sees the dashboard, expense entry, petty cash, reconciliation and card income.
- **Front desk, SDC 1 / SDC 2** only see the expense entry page.

Fake data is created from `lib/data/seed.ts` into `data/store.json` on first run. The dashboard has a **Reset demo data** button.

### Deploy on Vercel

The prototype deploys on Vercel with default settings: no environment variables, no secrets. On Vercel the fake data is kept in the server's temporary folder, so anything entered during a demo can reset back to the seed data when Vercel restarts the app.

### Code layout

- `lib/types.ts`: data shapes (planned Supabase tables).
- `lib/data/store.ts`: the only place that reads or writes data. Swap `JsonFileStore` for a Supabase version later.
- `lib/calc.ts`: P&L, petty cash and reconciliation maths, with no I/O.
- `app/`: pages and server actions.
