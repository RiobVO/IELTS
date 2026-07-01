-- 0033_leaderboard_authenticated :: down
-- Restore the original public (anon-readable) leaderboard policy + grant from 0001_rls.

DROP POLICY IF EXISTS leaderboard_select ON leaderboard_entry;
CREATE POLICY leaderboard_select ON leaderboard_entry
  FOR SELECT TO anon, authenticated USING (true);
GRANT SELECT ON leaderboard_entry TO anon;
