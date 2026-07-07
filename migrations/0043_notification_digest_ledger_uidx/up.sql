-- 0043_notification_digest_ledger_uidx :: up
-- Атомарный ledger идемпотентности weekly digest (fix TOCTOU). Оркестратор клеймит
-- юзера через INSERT ... ON CONFLICT DO NOTHING по (user_id, data->>'week'); без
-- БД-констрейнта параллельный cron + ручной прогон могли оба выбрать юзера
-- (leftJoin+isNull не атомарен с последующей вставкой) и оба отправить письмо.
-- Partial UNIQUE только по type='weekly_digest' — прочие типы уведомлений не
-- ограничены (badges/referral/system по-прежнему пишутся свободно). Прод-строк
-- weekly_digest ещё нет (фича не жила) — индекс встаёт чисто.

CREATE UNIQUE INDEX notification_weekly_digest_week_uidx
  ON notification (user_id, ((data->>'week')))
  WHERE type = 'weekly_digest';
