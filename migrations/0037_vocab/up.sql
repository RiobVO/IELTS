-- 0037_vocab :: up
-- Фича Vocabulary (интервальные флеш-карточки, план 2026-07-06). Три additive-
-- таблицы. Ядро Reading/Listening/Writing/Speaking не затрагивается.
--
-- Модель RLS зеркалит существующие таблицы:
--   * vocab_deck  — published-гейт как content_item (SELECT authenticated, политика
--     status='published'); source_file_path — ключ идемпотентного (ре)импорта.
--   * vocab_card  — published ЧЕРЕЗ дек (EXISTS-джойн, как passage→content_item).
--   * vocab_progress — per-user SRS-стейт (SM-2), owner-read; запись ТОЛЬКО
--     серверным экшеном (Drizzle owner) — авторитетный SM-2 + дневной cap, поэтому
--     клиентских INSERT/UPDATE/DELETE нет (ни grant, ни write-политики).
--
-- Статус/тариф переиспользуют content_status / user_tier (каталожная семантика
-- идентична content_item), новых enum'ов не заводим.
--
-- Гранты по secure-by-default (как 0035/0036): на проде Supabase раздаёт широкие
-- default-privileges новым таблицам, поэтому сначала REVOKE ALL от клиентских
-- ролей, затем отдаём точечно только нужное. Таблицы 29-31 (см. SCHEMA_NOTES.md).

-- ---------------------------------------------------------------------------
-- vocab_deck — набор слов (контент). Published-гейт как content_item.
-- ---------------------------------------------------------------------------
CREATE TABLE vocab_deck (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title            text NOT NULL,
  description      text,
  level            text,
  -- Ключ идемпотентности импорта (как content_item.source_file_path), но здесь
  -- NOT NULL UNIQUE — реимпорт апсертит дек по этому пути на уровне БД.
  source_file_path text NOT NULL UNIQUE,
  tier_required    user_tier NOT NULL DEFAULT 'basic',
  status           content_status NOT NULL DEFAULT 'draft',
  -- Денормализация для каталога (число карточек), пересчитывается при (ре)импорте.
  word_count       integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE vocab_deck ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON vocab_deck FROM anon, authenticated, PUBLIC;
GRANT SELECT ON vocab_deck TO authenticated;
GRANT ALL ON vocab_deck TO service_role;
CREATE POLICY vocab_deck_select_published ON vocab_deck
  FOR SELECT TO authenticated USING (status = 'published');

-- ---------------------------------------------------------------------------
-- vocab_card — слово в деке (контент). Видимо, когда его дек опубликован.
-- ---------------------------------------------------------------------------
CREATE TABLE vocab_card (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deck_id        uuid NOT NULL REFERENCES vocab_deck (id) ON DELETE CASCADE,
  "order"        integer NOT NULL,
  word           text NOT NULL,
  definition     text NOT NULL,
  example        text,
  translation    text,
  part_of_speech text,
  ipa            text,
  -- Фундамент идемпотентного upsert-реимпорта: слово уникально в пределах дека.
  CONSTRAINT vocab_card_deck_word_key UNIQUE (deck_id, word)
);
-- Упорядоченное чтение дека; leftmost deck_id покрывает FK-lookup + cascade-delete.
CREATE INDEX vocab_card_deck_order_idx ON vocab_card (deck_id, "order");

ALTER TABLE vocab_card ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON vocab_card FROM anon, authenticated, PUBLIC;
GRANT SELECT ON vocab_card TO authenticated;
GRANT ALL ON vocab_card TO service_role;
CREATE POLICY vocab_card_select_published ON vocab_card
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM vocab_deck d
    WHERE d.id = vocab_card.deck_id AND d.status = 'published'
  ));

-- ---------------------------------------------------------------------------
-- vocab_progress — per-user SRS-стейт (SM-2). Owner-read; запись owner-path.
-- ---------------------------------------------------------------------------
CREATE TABLE vocab_progress (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES profile (id) ON DELETE CASCADE,
  card_id          uuid NOT NULL REFERENCES vocab_card (id) ON DELETE CASCADE,
  ease             real NOT NULL DEFAULT 2.5,
  interval_days    integer NOT NULL DEFAULT 0,
  repetitions      integer NOT NULL DEFAULT 0,
  lapses           integer NOT NULL DEFAULT 0,
  due_at           timestamptz NOT NULL DEFAULT now(),
  last_reviewed_at timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vocab_progress_user_card_key UNIQUE (user_id, card_id)
);
-- Due-очередь: карточки пользователя, отсортированные по сроку повтора.
CREATE INDEX vocab_progress_user_due_idx ON vocab_progress (user_id, due_at);
-- FK-индекс card_id: ускоряет cascade-delete прогресса при реимпорте карточек
-- (user_id уже покрыт unique-констрейнтом слева).
CREATE INDEX vocab_progress_card_id_idx ON vocab_progress (card_id);

ALTER TABLE vocab_progress ENABLE ROW LEVEL SECURITY;
-- Прогресс пишется ТОЛЬКО серверным экшеном (Drizzle owner): авторитетный SM-2 +
-- дневной cap. Клиенту — только чтение своих строк; INSERT/UPDATE/DELETE закрыты
-- (нет grant, нет write-политики). REVOKE ALL закрывает и default-priv гранты Supabase.
REVOKE ALL ON vocab_progress FROM anon, authenticated, PUBLIC;
GRANT SELECT ON vocab_progress TO authenticated;
GRANT ALL ON vocab_progress TO service_role;
CREATE POLICY vocab_progress_select_own ON vocab_progress
  FOR SELECT TO authenticated USING (user_id = auth.uid());
