-- 0039_vocab_level_band :: down
-- Зеркальный реверт: сброс уровневой колонки. Nullable без данных на момент
-- отката — DROP COLUMN чист.

ALTER TABLE vocab_deck DROP COLUMN IF EXISTS level_band;
