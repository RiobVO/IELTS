-- 0037_vocab :: down
-- Полный реверт фичи Vocabulary. Порядок обратный FK-зависимостям
-- (progress → card → deck). Enum'ы не заводились (переиспользованы
-- content_status / user_tier), поэтому DROP TYPE не нужен.

DROP TABLE IF EXISTS vocab_progress;
DROP TABLE IF EXISTS vocab_card;
DROP TABLE IF EXISTS vocab_deck;
