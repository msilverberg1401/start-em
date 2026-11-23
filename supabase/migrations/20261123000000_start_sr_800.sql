-- New Ranked players start at 800 SR (mid-Starter). The game always writes sr explicitly; this keeps the default in step.
alter table public.ranked_stats alter column sr set default 800;
alter table public.ranked_stats alter column peak set default 800;
