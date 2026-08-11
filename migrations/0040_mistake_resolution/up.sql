-- 0040_mistake_resolution :: up
-- P9-rich «вариант B» (PRACTICE_PLAN, Фаза 3 волна B). ЕДИНСТВЕННАЯ additive-таблица
-- хранит ТОЛЬКО факт «ошибка отработана» (резолюцию). Открытые ошибки НЕ
-- материализуются: деривятся на чтении из attempt_review_snapshot + attempt.answers
-- через gradeOne (тот же грейдер, что submit). submitAttempt / грейдинг / рейтинг /
-- дневной кап не трогаются ни на байт. Ядро R/L/W/S не затрагивается.
--
-- RLS-постура зеркалит vocab_progress (per-user owner-стейт): запись ТОЛЬКО серверным
-- экшеном (Drizzle owner-path) — авторитетный «отработано» + revalidate, поэтому у
-- клиентских ролей нет ни INSERT/UPDATE/DELETE (ни grant, ни write-политики), только
-- SELECT своих строк. Гранты secure-by-default (как 0035/0037): на проде Supabase
-- раздаёт широкие default-privileges новым таблицам — сначала REVOKE ALL от клиентских
-- ролей, затем точечный GRANT SELECT. Таблица 32-я (см. SCHEMA_NOTES.md).

CREATE TABLE mistake_resolution (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES profile (id) ON DELETE CASCADE,
  content_item_id uuid NOT NULL REFERENCES content_item (id) ON DELETE CASCADE,
  question_number integer NOT NULL,
  -- qtype-слаг на момент резолюции: денормализованный ярлык (text, не enum — как
  -- content_item.question_types; канон валидирует серверный экшен). Открытый список
  -- ошибок берёт qtype из снапшота, эта колонка — снимок для аналитики/устойчивости.
  qtype           text NOT NULL,
  resolved_at     timestamptz NOT NULL DEFAULT now(),
  -- Одна резолюция на (юзер, тест, номер вопроса) — фундамент ON CONFLICT DO NOTHING
  -- в resolveMistake. Leftmost user_id обслуживает и owner-read (WHERE user_id = $1),
  -- и RLS-политику user_id = auth.uid(); отдельный (user_id)-индекс был бы избыточен.
  CONSTRAINT mistake_resolution_user_content_question_key
    UNIQUE (user_id, content_item_id, question_number)
);
-- FK-индекс content_item_id: cascade-delete резолюций при удалении теста
-- (content_item_id НЕ leftmost в unique-констрейнте — как vocab_progress.card_id).
CREATE INDEX mistake_resolution_content_item_id_idx
  ON mistake_resolution (content_item_id);

ALTER TABLE mistake_resolution ENABLE ROW LEVEL SECURITY;
-- Запись только owner-path серверным экшеном; клиенту — лишь SELECT своих строк.
-- REVOKE ALL закрывает default-priv гранты Supabase, затем точечный GRANT SELECT.
REVOKE ALL ON mistake_resolution FROM anon, authenticated, PUBLIC;
GRANT SELECT ON mistake_resolution TO authenticated;
GRANT ALL ON mistake_resolution TO service_role;
CREATE POLICY mistake_resolution_select_own ON mistake_resolution
  FOR SELECT TO authenticated USING (user_id = auth.uid());
