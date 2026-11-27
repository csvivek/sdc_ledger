-- Backups (feature 1 of the admin tools PR).
--
-- The Supabase project is on the Free plan, which keeps no automatic backups,
-- and the app cannot read Supabase's backup list without a management token.
-- So the app offers a full download of every table, and this table remembers
-- each download (who, when, how many rows per table) so the dashboard can
-- remind the admin when the last one is more than 7 days old.
--
-- Adds one table. Nothing existing is changed. Admin only; rows can be added
-- and read but never edited or removed, so the history can be trusted.

create table if not exists public.backup_log (
  id uuid primary key default gen_random_uuid(),
  format text not null check (format in ('json', 'xlsx')),
  total_rows int not null check (total_rows >= 0),
  counts jsonb not null default '{}'::jsonb,
  taken_by uuid not null default auth.uid() references auth.users (id),
  taken_at timestamptz not null default now()
);
create index if not exists backup_log_taken_at_idx on public.backup_log (taken_at desc);
create index if not exists backup_log_taken_by_idx on public.backup_log (taken_by);

alter table public.backup_log enable row level security;

drop policy if exists "admin read backup log" on public.backup_log;
drop policy if exists "admin add backup log" on public.backup_log;
create policy "admin read backup log" on public.backup_log
  for select to authenticated using ((select private.is_admin()));
create policy "admin add backup log" on public.backup_log
  for insert to authenticated with check ((select private.is_admin()) and taken_by = (select auth.uid()));

revoke all on public.backup_log from anon, authenticated;
grant select, insert on public.backup_log to authenticated;
