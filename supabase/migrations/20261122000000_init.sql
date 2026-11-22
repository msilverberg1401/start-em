-- Start 'Em schema. Every table is locked by RLS with no policies:
-- the browser never touches these directly; only the `game` edge function (service role) does.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null,
  created_at timestamptz not null default now()
);
create unique index profiles_username_lower on public.profiles (lower(username));

create table public.games (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  mode text not null check (mode in ('daily', 'ranked', 'casual')),
  play_date date,
  status text not null default 'active' check (status in ('active', 'done')),
  state jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- one Daily per account per day, and one unfinished Ranked game at a time
create unique index games_one_daily on public.games (user_id, play_date) where mode = 'daily';
create unique index games_one_active_ranked on public.games (user_id) where mode = 'ranked' and status = 'active';
create index games_casual_cleanup on public.games (created_at) where mode = 'casual';

create table public.daily_results (
  play_date date not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  username text not null,
  total numeric not null,
  pct numeric not null,
  grid text not null,
  finished_at timestamptz not null default now(),
  primary key (play_date, user_id)
);
create index daily_results_rank on public.daily_results (play_date, total desc, pct desc);

create table public.ranked_stats (
  user_id uuid primary key references auth.users (id) on delete cascade,
  username text not null,
  games int not null default 0,
  recent numeric[] not null default '{}',
  rating numeric not null default 0,
  best numeric not null default 0
);
create index ranked_stats_rating on public.ranked_stats (rating desc) where games >= 5;

create table public.best_lineups (
  user_id uuid primary key references auth.users (id) on delete cascade,
  username text not null,
  total numeric not null,
  pct numeric not null,
  mode text not null,
  lineup jsonb not null,
  finished_at timestamptz not null default now()
);
create index best_lineups_total on public.best_lineups (total desc);

alter table public.profiles enable row level security;
alter table public.games enable row level security;
alter table public.daily_results enable row level security;
alter table public.ranked_stats enable row level security;
alter table public.best_lineups enable row level security;
