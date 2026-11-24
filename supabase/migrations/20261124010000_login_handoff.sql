-- iPhone home screen app + Google login: Google runs in Safari, so Safari hands the login back to the app.
-- Safari stores the session's refresh token under a one-time random id only the app knows; the app takes it once.
-- Rows live a few minutes at most. RLS on with no policies: only the game edge function touches it.
create table if not exists public.auth_handoffs (
  id uuid primary key,
  refresh_token text not null,
  created_at timestamptz not null default now()
);
alter table public.auth_handoffs enable row level security;
grant all privileges on public.auth_handoffs to service_role;
