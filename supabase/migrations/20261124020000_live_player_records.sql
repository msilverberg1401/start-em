-- Keep a durable per-account result for each completed Live 1v1 match.
-- Match rows are cleaned up after a few days, so this table has no match foreign key.
create table if not exists public.live_results (
  match_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  result text not null check (result in ('win', 'loss', 'tie')),
  created_at timestamptz not null default now(),
  primary key (match_id, user_id)
);

alter table public.live_results enable row level security;
grant all privileges on public.live_results to service_role;

-- Backfill completed matches still inside the existing three-day match retention window.
insert into public.live_results (match_id, user_id, result)
select
  m.id,
  (s.seat->>'uid')::uuid,
  case
    when m.state #>> '{result,winner}' is null then 'tie'
    when (m.state #>> '{result,winner}')::int = s.idx - 1 then 'win'
    else 'loss'
  end
from public.matches m
cross join lateral jsonb_array_elements(m.state->'seats') with ordinality as s(seat, idx)
where m.status = 'done'
  and m.state ? 'result'
  and s.seat->>'uid' is not null
on conflict (match_id, user_id) do nothing;
