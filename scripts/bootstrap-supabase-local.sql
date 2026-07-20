-- LOCAL-ONLY: emulate the primitives Supabase provides out of the box, so the
-- app migrations can run against a plain Postgres (e.g. the docker-compose db).
-- Idempotent. NEVER part of the app migration set — on real Supabase these
-- already exist and this script is not run.

-- Roles: anon, authenticated, service_role (service_role bypasses RLS, as in Supabase).
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
END
$$;

-- auth schema + minimal users table (the FK target for profile.id).
CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text
);

-- auth.uid(): on Supabase this reads the `sub` claim from the request JWT.
-- Local stub returns a GUC so RLS policies that call auth.uid() stay valid.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
