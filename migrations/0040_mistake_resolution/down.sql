-- 0040_mistake_resolution :: down
-- Полный реверт. Индекс и RLS-политика уходят вместе с таблицей; новых enum'ов не
-- заводилось (qtype — text) → DROP TYPE не нужен.

DROP TABLE IF EXISTS mistake_resolution;
