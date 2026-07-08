-- 0046_notification_kind_dedup :: down
-- Обратимость: возвращаем постуру notification к состоянию до 0046 (грант UPDATE
-- как в 0001), снимаем дедуп-индекс и обе колонки. Индекс 0043 не трогали — он цел.

-- Возврат гранта UPDATE к 0001: REVOKE снимает колоночный read_at-грант, затем
-- табличный UPDATE обратно authenticated.
REVOKE UPDATE ON notification FROM authenticated;
GRANT UPDATE ON notification TO authenticated;

DROP INDEX IF EXISTS notification_user_dedup_key_uidx;

ALTER TABLE notification DROP COLUMN IF EXISTS dedup_key;
ALTER TABLE notification DROP COLUMN IF EXISTS kind;
