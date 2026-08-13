-- 0043_notification_digest_ledger_uidx :: down
-- Структурный реверс — снимаем ledger-уникальность weekly digest.

DROP INDEX IF EXISTS notification_weekly_digest_week_uidx;
