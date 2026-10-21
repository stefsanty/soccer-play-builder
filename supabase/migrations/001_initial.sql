
-- Plays table
create table plays (
  id          uuid primary key default gen_random_uuid(),
  author_id   uuid references auth.users(id) on delete cascade,
  author_name text not null default 'Anonymous',
  title       text not null,
  description text,
  formation   text not null default 'custom',
  is_public   boolean not null default false,
  tags        text[] not null default '{}',
  view_side   text not null default 'right',
  players     jsonb not null default '[]',
  steps       jsonb not null default '[]',
  fork_of     uuid references plays(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Indexes
create index plays_author_id_idx on plays(author_id);
create index plays_is_public_idx on plays(is_public) where is_public = true;
create index plays_created_at_idx on plays(created_at desc);

-- Updated_at trigger
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
create trigger plays_updated_at before update on plays
  for each row execute function update_updated_at();

-- RLS
alter table plays enable row level security;

-- Anyone can read public plays
create policy "Public plays are viewable by all"
  on plays for select
  using (is_public = true);

-- Authors can read their own plays (including private)
create policy "Authors can view own plays"
  on plays for select
  using (auth.uid() = author_id);

-- Authenticated users can create plays
create policy "Authenticated users can create plays"
  on plays for insert
  with check (auth.uid() = author_id);

-- Authors can update their own plays
create policy "Authors can update own plays"
  on plays for update
  using (auth.uid() = author_id);

-- Authors can delete their own plays
create policy "Authors can delete own plays"
  on plays for delete
  using (auth.uid() = author_id);
