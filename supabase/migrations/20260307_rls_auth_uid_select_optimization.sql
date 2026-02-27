-- Optimize RLS policy expressions by wrapping auth.uid() with SELECT.
-- This avoids per-row re-evaluation overhead in larger scans.

drop policy if exists "users_select_own" on public.users;
create policy "users_select_own"
on public.users
for select
using ((select auth.uid()) = id);

drop policy if exists "users_insert_own" on public.users;
create policy "users_insert_own"
on public.users
for insert
with check ((select auth.uid()) = id);

drop policy if exists "users_update_own" on public.users;
create policy "users_update_own"
on public.users
for update
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

drop policy if exists "votes_select_own" on public.votes;
create policy "votes_select_own"
on public.votes
for select
using ((select auth.uid()) = user_id);
