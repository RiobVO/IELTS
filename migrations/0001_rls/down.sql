-- 0001_rls :: down  (reverse of up.sql)
DROP POLICY IF EXISTS notification_update_own ON notification;
DROP POLICY IF EXISTS notification_select_own ON notification;
DROP POLICY IF EXISTS topic_select ON topic;
DROP POLICY IF EXISTS leaderboard_select ON leaderboard_entry;
DROP POLICY IF EXISTS referral_select_own ON referral;
DROP POLICY IF EXISTS user_badge_select_own ON user_badge;
DROP POLICY IF EXISTS badge_select ON badge;
DROP POLICY IF EXISTS attempt_update_own ON attempt;
DROP POLICY IF EXISTS attempt_insert_own ON attempt;
DROP POLICY IF EXISTS attempt_select_own ON attempt;
DROP POLICY IF EXISTS question_select_published ON question;
DROP POLICY IF EXISTS passage_select_published ON passage;
DROP POLICY IF EXISTS content_item_select_published ON content_item;
DROP POLICY IF EXISTS profile_update_own ON profile;
DROP POLICY IF EXISTS profile_insert_own ON profile;
DROP POLICY IF EXISTS profile_select_own ON profile;
DROP POLICY IF EXISTS region_select ON region;

ALTER TABLE notification      DISABLE ROW LEVEL SECURITY;
ALTER TABLE topic             DISABLE ROW LEVEL SECURITY;
ALTER TABLE leaderboard_entry DISABLE ROW LEVEL SECURITY;
ALTER TABLE referral          DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_badge        DISABLE ROW LEVEL SECURITY;
ALTER TABLE badge             DISABLE ROW LEVEL SECURITY;
ALTER TABLE attempt           DISABLE ROW LEVEL SECURITY;
ALTER TABLE answer_key        DISABLE ROW LEVEL SECURITY;
ALTER TABLE question          DISABLE ROW LEVEL SECURITY;
ALTER TABLE passage           DISABLE ROW LEVEL SECURITY;
ALTER TABLE content_item      DISABLE ROW LEVEL SECURITY;
ALTER TABLE profile           DISABLE ROW LEVEL SECURITY;
ALTER TABLE region            DISABLE ROW LEVEL SECURITY;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM service_role;
-- NOTE: `GRANT USAGE ON SCHEMA public` (from up.sql) is intentionally NOT revoked
-- here — on Supabase that schema-usage grant is a platform default that other
-- features rely on; revoking it would diverge from the managed baseline.
