-- 0050_answer_key_l1 :: up
-- L1 (Russian) explanations layer (BRIEF §12.3 content process). Two additive
-- columns, no new tables (APP_TABLE_COUNT stays 34):
--
-- * answer_key.explanation_ru — the Russian explanation next to the English one.
--   Generated OUTSIDE the deterministic import parser (BRIEF §4.2 stays LLM-free)
--   by a separate env-gated admin step; the parser/persist always write NULL.
--   Inherits answer_key's hard lock (RLS on, all client grants revoked in 0001) —
--   ADD COLUMN grants nothing, so no REVOKE/GRANT work is needed here.
--
-- * content_item.l1_status — pipeline state for that generation step
--   (pending → generating → done|failed). The 'generating' claim is what makes
--   concurrent generation runs safe (single UPDATE ... WHERE claim). Read only
--   by the admin review screen via the owner path; content_item SELECT grants
--   are column-level since 0035, so the new column is born unreadable to
--   anon/authenticated — intentionally left that way (admin-only metadata).

CREATE TYPE l1_gen_status AS ENUM ('pending', 'generating', 'done', 'failed');

ALTER TABLE answer_key ADD COLUMN explanation_ru text;
ALTER TABLE content_item ADD COLUMN l1_status l1_gen_status NOT NULL DEFAULT 'pending';
