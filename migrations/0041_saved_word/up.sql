-- 0041_saved_word :: up
-- P11 «Saved words» (PRACTICE_PLAN, Фаза 3 волна C). ЕДИНСТВЕННАЯ additive-таблица:
-- личный словарь пользователя — слово, закладываемое из пассажа в practice-чтении,
-- со своим SM-2-стейтом (то же ядро reviewCard, что vocab-деки). MVP LLM-free и БЕЗ
-- внешних словарей: хранит ТОЛЬКО слово + context (предложение, где оно встретилось) +
-- источник; авто-дефиниций нет, строки vocab_card НЕ синтезируются (published-контент
-- неприкосновенен). Vocab ВНЕ rating/leaderboard-контура — эта таблица тоже.
--
-- RLS-постура зеркалит vocab_progress / mistake_resolution (per-user owner-стейт):
-- запись ТОЛЬКО серверным экшеном (Drizzle owner-path) — авторитетный SM-2, поэтому у
-- клиентских ролей нет INSERT/UPDATE/DELETE (ни grant, ни write-политики), только SELECT
-- своих строк. Гранты secure-by-default (как 0037/0040): на проде Supabase раздаёт широкие
-- default-privileges новым таблицам — сначала REVOKE ALL от клиентских ролей, затем
-- точечный GRANT SELECT. Таблица 33-я (см. SCHEMA_NOTES.md).

CREATE TABLE saved_word (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                uuid NOT NULL REFERENCES profile (id) ON DELETE CASCADE,
  word                   text NOT NULL,
  -- Предложение-окружение слова (вырезается детерминированно из текста пассажа на
  -- клиенте, санитайзится/обрезается в экшене). DEFAULT '' — слово без контекста легально.
  context                text NOT NULL DEFAULT '',
  -- Источник (тест, из которого закладка). SET NULL при удалении теста — слово в личном
  -- словаре переживает депубликацию/удаление контента, только теряет обратную ссылку.
  source_content_item_id uuid REFERENCES content_item (id) ON DELETE SET NULL,
  -- SM-2 стейт (то же ядро, что vocab_progress). ease — фактор лёгкости, стартовый 2.5.
  ease                   real NOT NULL DEFAULT 2.5,
  interval_days          integer NOT NULL DEFAULT 0,
  repetitions            integer NOT NULL DEFAULT 0,
  lapses                 integer NOT NULL DEFAULT 0,
  due_at                 timestamptz NOT NULL DEFAULT now(),
  last_reviewed_at       timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now()
);

-- Одно слово на пользователя, регистронезависимо: закладка «Research» и «research» —
-- одна запись (фундамент ON CONFLICT DO NOTHING в saveWord). Выражение lower(word)
-- требует UNIQUE INDEX (табличный UNIQUE-констрейнт выражения не принимает). Leftmost
-- user_id обслуживает и owner-read (WHERE user_id = $1), и RLS-политику user_id = auth.uid().
CREATE UNIQUE INDEX saved_word_user_lower_word_key
  ON saved_word (user_id, lower(word));
-- Due-очередь «My words»: слова пользователя, отсортированные по сроку повтора. Отдельный
-- индекс нужен, т.к. второй столбец unique-индекса — lower(word), а не due_at.
CREATE INDEX saved_word_user_due_idx ON saved_word (user_id, due_at);
-- FK-индекс source_content_item_id: ускоряет ON DELETE SET NULL при удалении теста
-- (source_content_item_id НЕ leftmost в unique-индексе — как mistake_resolution.content_item_id).
CREATE INDEX saved_word_source_content_item_id_idx ON saved_word (source_content_item_id);

ALTER TABLE saved_word ENABLE ROW LEVEL SECURITY;
-- Запись только owner-path серверным экшеном; клиенту — лишь SELECT своих строк.
-- REVOKE ALL закрывает default-priv гранты Supabase, затем точечный GRANT SELECT.
REVOKE ALL ON saved_word FROM anon, authenticated, PUBLIC;
GRANT SELECT ON saved_word TO authenticated;
GRANT ALL ON saved_word TO service_role;
CREATE POLICY saved_word_select_own ON saved_word
  FOR SELECT TO authenticated USING (user_id = auth.uid());
