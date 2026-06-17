-- 0009_migrations_rls :: up
-- Supabase Advisor flags public._migrations as RLS-disabled. It's bookkeeping for
-- the custom migrator (scripts/migrate.ts), which connects as the postgres OWNER
-- and therefore bypasses RLS. Enable RLS with NO policies so anon/authenticated
-- get no access at all (the table never should be client-reachable), while the
-- owner migrator keeps full read/write — including the INSERT that records this
-- very migration, run in the same owner transaction.
ALTER TABLE public._migrations ENABLE ROW LEVEL SECURITY;
