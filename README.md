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
- **Database:** Supabase Postgres (schema in `supabase/migrations/`)
- **Login:** Supabase Auth (admin sees everything; other users can only enter data)
- **File storage:** Supabase Storage (bank statements, PappyJoe exports, receipts)

## Status

The app runs in one of two modes, chosen automatically:

- **Prototype mode** (no Supabase settings): fake data and a mock login where you pick a user. Nothing is saved for real.
- **Live mode** (Supabase settings present): data is saved in Supabase Postgres, and people log in with an email and password through Supabase Auth.

### Environment variables

| Name | Where to find it |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase dashboard > Project Settings > API: the Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Same page: the `anon` public key (newer projects call it the publishable key) |

Both are safe to expose in the browser; the database is protected by row level security. Do **not** use the `service_role` / secret key anywhere in this app. Never commit real values; `.env.example` lists the names only.

### Set up live mode

1. **Create a Supabase project** at supabase.com (pick the Mumbai region for India).
2. **Create the tables:** in the Supabase dashboard open SQL Editor > New query, paste all of `supabase/migrations/20261125000000_initial_schema.sql`, and click Run.
3. **Turn off public sign-ups:** Authentication > Sign In / Providers > switch off "Allow new users to sign up". Only the admin adds people.
4. **Add the environment variables in Vercel:** Project > Settings > Environment Variables. Add both names above with their values, ticked for Production and Preview. Then Deployments > latest > Redeploy (the values are read at build time).
5. **Create the first admin:** Supabase > Authentication > Users > Add user > Create new user, enter the email and a password, and tick "Auto Confirm User". Then in SQL Editor run:

   ```sql
   update public.profiles set role = 'admin', name = 'Doctor' where email = 'doctor@example.com';
   ```

6. **Add staff** the same way (Add user). New users are staff by default. Set their name and home clinic with:

   ```sql
   update public.profiles set name = 'Front desk SDC1', clinic = 'SDC1' where email = 'desk1@example.com';
   ```

Who sees what: the **admin** sees and edits everything. **Staff** can add expenses and see only the expenses they entered.

PappyJoe income, bank deposits, petty cash transfers and card payments have no entry screens yet; those tables start empty in live mode.

### Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000. Without a `.env.local` you get prototype mode: pick a user on the login page (no password).

- **Doctor (Admin)** sees the dashboard, expense entry, petty cash, reconciliation and card income.
- **Front desk, SDC 1 / SDC 2** only see the expense entry page.

Fake data is created from `lib/data/seed.ts` into `data/store.json` on first run. The dashboard has a **Reset demo data** button (prototype mode only). On Vercel without Supabase settings, fake data lives in the server's temporary folder and can reset when Vercel restarts the app.

### Code layout

- `lib/types.ts`: data shapes (planned Supabase tables).
- `lib/data/store.ts`: the only place that reads or writes data. Picks `SupabaseLedgerStore` (`lib/data/supabase-store.ts`) in live mode, else the fake-data `JsonFileStore`.
- `lib/supabase/`: environment variable check and the server-side Supabase client.
- `lib/auth.ts`: current user; Supabase Auth in live mode, mock cookie otherwise.
- `middleware.ts`: refreshes the Supabase login session.
- `supabase/migrations/`: database schema and row level security rules.
- `lib/calc.ts`: P&L, petty cash and reconciliation maths, with no I/O.
- `app/`: pages and server actions.
