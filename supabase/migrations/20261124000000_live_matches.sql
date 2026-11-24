-- Live head-to-head matches: two players, the same seven teams, a 30-second pick each roll, picks revealed together.
-- Same rule as every other table: RLS on with no policies; only the game edge function (service role) touches it.
create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  host uuid references auth.users (id) on delete set null,
  status text not null default 'waiting' check (status in ('waiting', 'playing', 'done')),
  state jsonb not null,
  version int not null default 0,          -- bumped on every save, so two requests can't overwrite each other
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists matches_created on public.matches (created_at);
alter table public.matches enable row level security;
grant all privileges on public.matches to service_role;
