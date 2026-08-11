-- 0039_vocab_level_band :: up
-- Уровневый каталог Vocabulary: опциональный CEFR-уровень дека (B1|B2|C1) для
-- секционирования грида по уровню. Одна additive-колонка, nullable, без DEFAULT и
-- без CHECK — канон {B1,B2,C1} валидирует парсер на app-уровне (прецедент
-- question_types и свободного level). Существующие деки не трогаются: NULL → дек
-- уходит в секцию «More decks».
--
-- RLS/grants НЕ меняются: колонка наследует постуру vocab_deck (published-read
-- публичная мета каталога, как level / question_types).

ALTER TABLE vocab_deck ADD COLUMN level_band text;
