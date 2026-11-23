-- Past Dailies played later count on that day's standings and the profile calendar, marked "late".
-- Late results don't count toward streaks (you can't keep a streak by playing yesterday's Daily today).
alter table public.daily_results add column if not exists late boolean not null default false;

-- backfill past Dailies already finished by logged-in players
insert into public.daily_results (play_date, user_id, username, total, pct, grid, picks, late, finished_at)
select g.play_date, g.user_id, p.username,
  (g.state->'result'->>'total')::numeric, (g.state->'result'->>'pct')::numeric, g.state->'result'->>'grid',
  (select jsonb_agg(jsonb_build_object('i', x.i - 1, 'rollKey', x.p->>'rollKey', 'id', x.p->'player'->>'id',
     'name', x.p->'player'->>'name', 'pts', (x.p->'player'->>'pts')::numeric, 'slot', x.p->>'slot'))
   from jsonb_array_elements(g.state->'picks') with ordinality as x(p, i)),
  true, g.updated_at
from public.games g join public.profiles p on p.id = g.user_id
where g.mode = 'archive' and g.status = 'done' and g.user_id is not null
on conflict (play_date, user_id) do nothing;
