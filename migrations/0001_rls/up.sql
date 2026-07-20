-- 0001_rls :: up
-- Row-Level Security (BRIEF §6.1). The browser talks to Postgres with the
-- Supabase anon/authenticated roles, so EVERY public table is RLS-protected.
-- `answer_key` is hard-locked to service-role; grading runs server-side only.
-- Roles anon/authenticated/service_role are provided by Supabase (locally
-- emulated by scripts/bootstrap-supabase-local.sql).

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- service_role is the grading/admin role (BYPASSRLS in Supabase). Full access.
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- Turn RLS on for all 13 tables.
ALTER TABLE region            ENABLE ROW LEVEL SECURITY;
ALTER TABLE profile           ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_item      ENABLE ROW LEVEL SECURITY;
ALTER TABLE passage           ENABLE ROW LEVEL SECURITY;
ALTER TABLE question          ENABLE ROW LEVEL SECURITY;
ALTER TABLE answer_key        ENABLE ROW LEVEL SECURITY;
ALTER TABLE attempt           ENABLE ROW LEVEL SECURITY;
ALTER TABLE badge             ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_badge        ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral          ENABLE ROW LEVEL SECURITY;
ALTER TABLE leaderboard_entry ENABLE ROW LEVEL SECURITY;
ALTER TABLE topic             ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification      ENABLE ROW LEVEL SECURITY;

-- region: public reference data (read-only to clients).
GRANT SELECT ON region TO anon, authenticated;
CREATE POLICY region_select ON region
  FOR SELECT TO anon, authenticated USING (true);

-- profile: a user can read/insert/update only their own row.
GRANT SELECT, INSERT, UPDATE ON profile TO authenticated;
CREATE POLICY profile_select_own ON profile
  FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY profile_insert_own ON profile
  FOR INSERT TO authenticated WITH CHECK (id = auth.uid());
CREATE POLICY profile_update_own ON profile
  FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- content_item: clients see only published content.
GRANT SELECT ON content_item TO anon, authenticated;
CREATE POLICY content_item_select_published ON content_item
  FOR SELECT TO anon, authenticated USING (status = 'published');

-- passage: visible only when its content_item is published.
GRANT SELECT ON passage TO anon, authenticated;
CREATE POLICY passage_select_published ON passage
  FOR SELECT TO anon, authenticated
  USING (EXISTS (
    SELECT 1 FROM content_item c
    WHERE c.id = passage.content_item_id AND c.status = 'published'
  ));

-- question: prompts visible when content_item is published (answers live in
-- answer_key, which is locked below).
GRANT SELECT ON question TO anon, authenticated;
CREATE POLICY question_select_published ON question
  FOR SELECT TO anon, authenticated
  USING (EXISTS (
    SELECT 1 FROM content_item c
    WHERE c.id = question.content_item_id AND c.status = 'published'
  ));

-- answer_key: LOCKED. Defence-in-depth — RLS enabled with no anon/authenticated
-- policy (default deny) AND table grants revoked. Only service_role may touch it.
REVOKE ALL ON answer_key FROM anon, authenticated, PUBLIC;

-- attempt: a user owns their attempts.
GRANT SELECT, INSERT, UPDATE ON attempt TO authenticated;
CREATE POLICY attempt_select_own ON attempt
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY attempt_insert_own ON attempt
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY attempt_update_own ON attempt
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- badge: public catalog.
GRANT SELECT ON badge TO anon, authenticated;
CREATE POLICY badge_select ON badge
  FOR SELECT TO anon, authenticated USING (true);

-- user_badge: a user sees their own earned badges.
GRANT SELECT ON user_badge TO authenticated;
CREATE POLICY user_badge_select_own ON user_badge
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- referral: a user sees referrals they created.
GRANT SELECT ON referral TO authenticated;
CREATE POLICY referral_select_own ON referral
  FOR SELECT TO authenticated USING (inviter_id = auth.uid());

-- leaderboard_entry: publicly viewable (precomputed ranks).
-- Anti-cheat (§4.6): hidden_from_leaderboard accounts must never surface. RLS
-- here is open (USING true) because the precompute job is the gatekeeper — it
-- MUST exclude profiles where hidden_from_leaderboard before writing rows. (Job
-- is Phase 2; see SCHEMA_NOTES.md.)
GRANT SELECT ON leaderboard_entry TO anon, authenticated;
CREATE POLICY leaderboard_select ON leaderboard_entry
  FOR SELECT TO anon, authenticated USING (true);

-- topic: public catalog (Writing/Speaking stubs).
GRANT SELECT ON topic TO anon, authenticated;
CREATE POLICY topic_select ON topic
  FOR SELECT TO anon, authenticated USING (true);

-- notification: a user sees/updates their own.
GRANT SELECT, UPDATE ON notification TO authenticated;
CREATE POLICY notification_select_own ON notification
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY notification_update_own ON notification
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
