-- 0038_vocab_enrichment :: down
-- Зеркальный реверт: сброс enrichment/quiz-колонок карточки и question_types дека.
-- Колонки nullable без данных на момент отката — DROP COLUMN чист.

ALTER TABLE vocab_deck DROP COLUMN IF EXISTS question_types;

ALTER TABLE vocab_card DROP COLUMN IF EXISTS accepted_answers;
ALTER TABLE vocab_card DROP COLUMN IF EXISTS quiz_prompt;
ALTER TABLE vocab_card DROP COLUMN IF EXISTS word_family;
ALTER TABLE vocab_card DROP COLUMN IF EXISTS collocations;
ALTER TABLE vocab_card DROP COLUMN IF EXISTS synonyms;
