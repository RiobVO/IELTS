-- 0033_leaderboard_authenticated :: up
-- #18: leaderboard_entry was readable by anon via the Supabase REST endpoint
-- (/rest/v1/leaderboard_entry?select=*), exposing user_id (uuid) + rating of every
-- non-hidden profile. The app never uses that path — every read is owner-side (Drizzle,
-- RLS-bypassing) under requireUser (leaderboard/page.tsx, app/page.tsx, profile/page.tsx,
-- the recompute/snapshot jobs). Anon access was pure REST attack surface. Restrict SELECT
-- to authenticated: Postgres can't ALTER a policy's TO role list, so drop + recreate it,
-- and revoke the anon grant. authenticated keeps its 0001 grant (leaderboard stays visible
-- to logged-in users by design). hidden_from_leaderboard is still enforced by the
-- precompute job (it never writes hidden profiles), unchanged here.

DROP POLICY IF EXISTS leaderboard_select ON leaderboard_entry;
CREATE POLICY leaderboard_select ON leaderboard_entry
  FOR SELECT TO authenticated USING (true);
REVOKE SELECT ON leaderboard_entry FROM anon;
