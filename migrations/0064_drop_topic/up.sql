-- 0064_drop_topic :: up
-- Легаси Phase 1: заглушка каталога Writing/Speaking-тем, вытесненная реальными
-- writing_task/speaking_task (0023/0027). Drizzle-экспорт снят как мёртвый код
-- давно, inbound-FK нет, на проде 0 строк — таблица жила только в БД и в
-- расхождении счётчиков (DB 37 vs schema.ts 36). После дропа оба равны 36.
-- Enum topic_skill остаётся: его тип — часть 0000_init, down воспроизводит
-- таблицу поверх него.

DROP TABLE topic;
