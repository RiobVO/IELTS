-- 0009_migrations_rls :: down
-- Restore the pre-0009 state: RLS disabled on the bookkeeping table.
ALTER TABLE public._migrations DISABLE ROW LEVEL SECURITY;
