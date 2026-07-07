-- 0044_mistake_review :: up
-- Учебная петля (BRIEF §12.3 шаг 2), SR-волна. SM-2-расписание повторов для открытых
-- ошибок practice-режима: `mistake_resolution` (0040) хранит терминальное «закрыто»,
-- эта таблица — промежуточный SR-стейт ДО закрытия, зеркало `saved_word` (0041), то же
-- ядро reviewCard (src/lib/vocab/srs.ts). Открытые ошибки по-прежнему деривятся на
-- чтении (attempt_review_snapshot + gradeOne) — эта таблица лишь пришивает к каждой
-- (юзер, тест, вопрос) SM-2-расписание due_at; submitAttempt/грейдинг/рейтинг/дневной
-- кап не трогаются ни на байт.
--
-- RLS-постура зеркалит saved_word/mistake_resolution (per-user owner-стейт): запись
-- ТОЛЬКО серверным экшеном (Drizzle owner-path, reviewMistake) — авторитетный SM-2,
-- поэтому у клиентских ролей нет INSERT/UPDATE/DELETE (ни grant, ни write-политики),
-- только SELECT своих строк. Гранты secure-by-default (как 0037/0040/0041): на проде
-- Supabase раздаёт широкие default-privileges новым таблицам — сначала REVOKE ALL от
-- клиентских ролей, затем точечный GRANT SELECT. Таблица 34-я (см. SCHEMA_NOTES.md).

CREATE TABLE mistake_review (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES profile (id) ON DELETE CASCADE,
  content_item_id  uuid NOT NULL REFERENCES content_item (id) ON DELETE CASCADE,
  question_number  integer NOT NULL,
  -- Денормализованный qtype-слаг на момент первого ревью (как mistake_resolution.qtype) —
  -- снимок для фильтра по типу на /app/practice/mistakes, не канон-enum.
  qtype            text NOT NULL,
  -- SM-2 стейт (то же ядро reviewCard, что vocab_progress/saved_word). ease — фактор
  -- лёгкости, стартовый 2.5.
  ease             real NOT NULL DEFAULT 2.5,
  interval_days    integer NOT NULL DEFAULT 0,
  repetitions      integer NOT NULL DEFAULT 0,
  lapses           integer NOT NULL DEFAULT 0,
  due_at           timestamptz NOT NULL DEFAULT now(),
  last_reviewed_at timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  -- Одна SR-запись на (юзер, тест, номер вопроса) — фундамент ON CONFLICT DO UPDATE
  -- в reviewMistake. Leftmost user_id обслуживает и owner-read (WHERE user_id = $1),
  -- и RLS-политику user_id = auth.uid().
  CONSTRAINT mistake_review_user_content_question_key
    UNIQUE (user_id, content_item_id, question_number)
);
-- Due-очередь «Due now»: SR-карточки пользователя по сроку повтора (как saved_word_user_due_idx).
CREATE INDEX mistake_review_user_due_idx ON mistake_review (user_id, due_at);
-- FK-индекс content_item_id: ускоряет ON DELETE CASCADE при удалении теста
-- (content_item_id НЕ leftmost в unique-констрейнте — как mistake_resolution.content_item_id).
CREATE INDEX mistake_review_content_item_id_idx ON mistake_review (content_item_id);

ALTER TABLE mistake_review ENABLE ROW LEVEL SECURITY;
-- Запись только owner-path серверным экшеном; клиенту — лишь SELECT своих строк.
-- REVOKE ALL закрывает default-priv гранты Supabase, затем точечный GRANT SELECT.
REVOKE ALL ON mistake_review FROM anon, authenticated, PUBLIC;
GRANT SELECT ON mistake_review TO authenticated;
GRANT ALL ON mistake_review TO service_role;
CREATE POLICY mistake_review_select_own ON mistake_review
  FOR SELECT TO authenticated USING (user_id = auth.uid());
