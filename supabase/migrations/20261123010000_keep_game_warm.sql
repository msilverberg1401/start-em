-- Keep the game function awake so the first visit after a quiet spell doesn't wait for a cold start
-- (booting the function and loading the player data). A logged-out "me" call is tiny and touches no tables.
-- Every 3 minutes = ~14,400 calls a month, far under the free plan's edge function limit.
select cron.unschedule('start-em-keep-warm') where exists (select 1 from cron.job where jobname = 'start-em-keep-warm');
select cron.schedule('start-em-keep-warm', '*/3 * * * *', $$
  select net.http_post(
    url := 'https://rcwmvwtlorrqlsmviuny.supabase.co/functions/v1/game',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := '{"action":"me"}'::jsonb);
$$);
