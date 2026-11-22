-- Share-card images (public, for link previews) and daily-reminder push subscriptions.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cards', 'cards', true, 2097152, array['image/png'])
on conflict (id) do nothing;

create table if not exists public.push_subscriptions (
  endpoint text primary key,
  user_id uuid references auth.users (id) on delete cascade,
  sub jsonb not null,
  created_at timestamptz not null default now(),
  last_sent date
);
alter table public.push_subscriptions enable row level security;
