-- Newer Supabase projects don't auto-grant table privileges to API roles for tables made in migrations.
-- Only the game edge function (service_role) reads and writes these tables; anon and authenticated
-- stay locked out (RLS is on with no policies), so grant to service_role alone.
grant usage on schema public to service_role;
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- and for anything future migrations add
alter default privileges in schema public grant all privileges on tables to service_role;
alter default privileges in schema public grant all privileges on sequences to service_role;
alter default privileges in schema public grant execute on functions to service_role;
