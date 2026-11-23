-- Simple daily counters for the owner's stats page: visits, games opened, how far people get, games finished.
-- No personal data: just (day, key) -> count. Day is Eastern time, same as the Daily.
create table if not exists public.stat_counts (
  day date not null,
  key text not null,
  n bigint not null default 0,
  primary key (day, key)
);
alter table public.stat_counts enable row level security;
grant all privileges on public.stat_counts to service_role;

create or replace function public.bump_stat(k text) returns void language sql security definer set search_path = public as $$
  insert into public.stat_counts (day, key, n) values ((now() at time zone 'America/New_York')::date, k, 1)
  on conflict (day, key) do update set n = public.stat_counts.n + 1;
$$;
revoke all on function public.bump_stat(text) from public, anon, authenticated;
grant execute on function public.bump_stat(text) to service_role;
