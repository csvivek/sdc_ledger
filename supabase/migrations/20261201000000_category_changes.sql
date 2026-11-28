-- History of category changes: who changed what, when, from what to what.
-- Covers expenses typed into the app ("expense") and bank payments ("bank").
-- Values are stored as text as they read at the time, so the history still
-- says what it said even if a category is renamed later.
-- Admin only, like the bank tables.

create table public.category_changes (
  id uuid primary key default gen_random_uuid(),
  target text not null check (target in ('expense', 'bank')),
  target_id uuid not null,
  old_value text not null,
  new_value text not null,
  changed_by uuid not null default auth.uid() references auth.users (id),
  changed_at timestamptz not null default now()
);
create index category_changes_target_idx on public.category_changes (target, target_id);

alter table public.category_changes enable row level security;
create policy "admin manage category changes" on public.category_changes
  for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));

revoke all on public.category_changes from anon;
grant select, insert on public.category_changes to authenticated;
