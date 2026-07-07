-- 0041_saved_word :: down
-- Полный реверт. Индексы и RLS-политика уходят вместе с таблицей; новых enum'ов не
-- заводилось (ease/interval — числовые) → DROP TYPE не нужен.

DROP TABLE IF EXISTS saved_word;
