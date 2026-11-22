-- Challenges, groups, lifetime stats. Same rule as before: RLS on, no policies; only the edge function reads/writes.

alter table public.games drop constraint if exists games_mode_check;
alter table public.games add constraint games_mode_check check (mode in ('daily', 'ranked', 'casual', 'challenge'));
alter table public.games add column if not exists challenge_of uuid references public.games (id) on delete set null;
create index if not exists games_challenge_of on public.games (user_id, challenge_of) where mode = 'challenge';
-- casual/challenge games no longer need to be anonymous; keep pruning only anonymous throwaways
create index if not exists games_anon_cleanup on public.games (created_at) where user_id is null;

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  owner uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.group_members (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index group_members_user on public.group_members (user_id);

create table public.user_stats (
  user_id uuid primary key references auth.users (id) on delete cascade,
  games int not null default 0,
  greens int not null default 0,
  best_wins int not null default 0,
  best_pick jsonb,
  worst_miss jsonb
);

create index if not exists daily_results_user on public.daily_results (user_id, play_date desc);

alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.user_stats enable row level security;
