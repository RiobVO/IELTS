-- 0038_vocab_enrichment :: up
-- Аддитивное обогащение Vocabulary (план V7/V9/V10): enrichment-поля карточки
-- (синонимы/коллокации/словарная семья) + опциональный quiz-режим (fill-in-blank
-- prompt + принимаемые ответы) на vocab_card, и список типов вопросов на vocab_deck.
-- Только ADD COLUMN, всё nullable, без DEFAULT — существующие строки не трогаются,
-- реимпорт заполняет поля через аддитивный upsert (vocab_progress не затрагивается).
--
-- RLS/grants НЕ меняются: новые колонки наследуют постуру своих таблиц.
--   * vocab_card остаётся published-read-контентом БЕЗ answer_key-лока — это
--     self-graded study material (обоснование в SCHEMA_NOTES 0037). quiz_prompt и
--     accepted_answers — тот же класс данных: ответ = само слово карточки, которое
--     пользователь и так видит в опубликованном деке, скрывать нечего → лок не нужен.
--   * vocab_deck.question_types — публичная мета каталога, как content_item.question_types.

ALTER TABLE vocab_card ADD COLUMN synonyms        text[];
ALTER TABLE vocab_card ADD COLUMN collocations    text[];
ALTER TABLE vocab_card ADD COLUMN word_family     text[];
ALTER TABLE vocab_card ADD COLUMN quiz_prompt     text;
ALTER TABLE vocab_card ADD COLUMN accepted_answers text[];

ALTER TABLE vocab_deck ADD COLUMN question_types  text[];
