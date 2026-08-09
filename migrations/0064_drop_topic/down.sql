-- 0064_drop_topic :: down
-- Полный контракт 0000_init + 0001_rls для topic (структура, RLS, grants,
-- политика). Данных не было (0 строк) — rollback чисто схемный.

CREATE TABLE topic (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  skill         topic_skill NOT NULL,
  prompt        text NOT NULL,
  tier_required user_tier NOT NULL DEFAULT 'basic',
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE topic ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON topic TO anon, authenticated;
CREATE POLICY topic_select ON topic
  FOR SELECT TO anon, authenticated USING (true);
