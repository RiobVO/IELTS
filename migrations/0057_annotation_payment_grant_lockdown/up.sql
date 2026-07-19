-- 0057_annotation_payment_grant_lockdown :: up
-- Завершение серии lockdown-миграций (0047/0048/0056): annotation (0013) и
-- payment (0006) получали GRANT SELECT без REVOKE ALL, и на проде Supabase
-- default privileges оставили anon все табличные привилегии, а authenticated —
-- всё сверх SELECT. Ревью волны 1.5 напомнило: RLS НЕ покрывает TRUNCATE,
-- REFERENCES и TRIGGER — «инертный» дрейф на этих привилегиях не был инертен.
-- Клиентский контракт не меняется: authenticated сохраняет policy-scoped SELECT
-- (историю платежей читает /app/profile supabase-клиентом), все записи в обе
-- таблицы идут owner-path. На локальной БД лишних грантов нет — REVOKE
-- идемпотентно схлопывается в no-op.
REVOKE ALL ON annotation FROM anon;
REVOKE ALL ON payment FROM anon;
REVOKE INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE ON annotation FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE ON payment FROM authenticated;
