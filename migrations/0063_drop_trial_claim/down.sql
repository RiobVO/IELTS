-- 0063_drop_trial_claim :: down
-- СХЕМНЫЙ rollback: воспроизводит структурный контракт 0054/up.sql (таблица,
-- индекс, RLS, гранты, backfill), но НЕ исторические строки — 7 claim-строк,
-- удалённых up-миграцией, невосстановимы иначе как из pg_dump-бэкапа. Backfill
-- ниже честно отработает по семантике 0054 и после пивота (tier_required <>
-- 'basic' сейчас не матчит ничего) вернёт ноль строк — это корректно: источником
-- решения всегда был attempt, а не эта таблица.

CREATE TABLE trial_claim (
  user_id         uuid PRIMARY KEY REFERENCES profile (id) ON DELETE CASCADE,
  content_item_id uuid NOT NULL REFERENCES content_item (id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX trial_claim_content_item_id_idx ON trial_claim (content_item_id);

ALTER TABLE trial_claim ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON trial_claim FROM anon, authenticated, PUBLIC;
GRANT ALL ON trial_claim TO service_role;

INSERT INTO trial_claim (user_id, content_item_id, created_at)
SELECT DISTINCT ON (a.user_id)
  a.user_id, a.content_item_id, a.started_at
FROM attempt a
JOIN content_item ci ON ci.id = a.content_item_id
WHERE ci.category IN ('full_reading', 'full_listening')
  AND ci.tier_required <> 'basic'
ORDER BY a.user_id, a.started_at ASC
ON CONFLICT (user_id) DO NOTHING;
