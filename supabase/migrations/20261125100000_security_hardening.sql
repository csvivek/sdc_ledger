-- SDC Ledger: security and performance fixes from the Supabase advisors.
-- Runs after 20261125000000_initial_schema.sql.

-- 1. handle_new_user() is only a trigger. Nobody should call it through the API.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- 2. is_admin() is only used inside the row level security policies. Move it
--    to a schema the API does not expose, so it cannot be called as
--    /rest/v1/rpc/is_admin. Policies point at the function itself, so they
--    keep working after the move.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;
alter function public.is_admin() set schema private;
revoke execute on function private.is_admin() from public, anon;
grant execute on function private.is_admin() to authenticated;

-- 3. Logged-out visitors (anon) never need table access. RLS already blocks
--    them; this removes the default grants too.
revoke all on all tables in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;

-- 4. Evaluate auth.uid() once per query instead of once per row.
alter policy "read own profile" on public.profiles
  using (id = (select auth.uid()));
alter policy "add own expenses" on public.expenses
  with check (entered_by = (select auth.uid()));
alter policy "read own expenses" on public.expenses
  using (entered_by = (select auth.uid()));
