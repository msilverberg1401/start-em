-- Daily stats (who picked whom) and past-Daily archive games.
alter table public.daily_results add column if not exists picks jsonb;

alter table public.games drop constraint if exists games_mode_check;
alter table public.games add constraint games_mode_check check (mode in ('daily', 'ranked', 'casual', 'challenge', 'archive'));
-- one archive attempt per account per past Daily
create unique index if not exists games_one_archive on public.games (user_id, play_date) where mode = 'archive';
