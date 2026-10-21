-- MVP: no auth yet. Replace the auth-gated policies from 001 with open ones
-- so the anon key can save, load, update and delete plays.
-- Tighten again (restore author checks) when sign-in is wired up.

drop policy if exists "Public plays are viewable by all" on plays;
drop policy if exists "Authors can view own plays" on plays;
drop policy if exists "Authenticated users can create plays" on plays;
drop policy if exists "Authors can update own plays" on plays;
drop policy if exists "Authors can delete own plays" on plays;

create policy "mvp read" on plays for select using (true);
create policy "mvp insert" on plays for insert with check (true);
create policy "mvp update" on plays for update using (true);
create policy "mvp delete" on plays for delete using (true);
