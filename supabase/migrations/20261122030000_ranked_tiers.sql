-- Ranked ladder: skill rating (SR) with tiers, placement games, recent changes and peak.
alter table public.ranked_stats add column if not exists sr int not null default 1000;
alter table public.ranked_stats add column if not exists peak int not null default 1000;
alter table public.ranked_stats add column if not exists history jsonb not null default '[]';
create index if not exists ranked_stats_sr on public.ranked_stats (sr desc) where games >= 5;
