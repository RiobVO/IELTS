-- 0046_notification_kind_dedup :: up
-- Инфраструктура уведомлений, волна 2. Две задачи:
--
-- 1) `kind` — first-class дискриминатор подтипа. Раньше подтип system-уведомлений
--    жил только в jsonb (`data->>'kind'` = vocab_due_reminder), что мешало дедупу и
--    индексации. Теперь это отдельная колонка. Enum notification_type НЕ расширяем:
--    ADD VALUE необратим и сломал бы down-контракт; kind покрывает подтипы поверх
--    крупного type. Backfill детерминированный: для system берём подтип из data
--    (vocab_due_reminder/…), иначе — сам type.
--
-- 2) `dedup_key` + партиальный уникальный индекс (user_id, dedup_key) — обобщение
--    ledger'а 0043 (weekly digest). Даёт атомарный идемпотентный claim для ЛЮБОГО
--    периодического продюсера (vocab-due, streak): INSERT ... ON CONFLICT DO NOTHING
--    закрывает TOCTOU параллельных прогонов cron без отдельного leftJoin-дедупа.
--    Индекс 0043 (notification_weekly_digest_week_uidx) НЕ трогаем — сосуществует.
--
-- 3) RLS-ужесточение: клиент (authenticated) больше не может переписать
--    title/body/data/kind своих строк — только пометить прочитанным (read_at).
--    Политика notification_update_own (0001) остаётся; сужаем ГРАНТ до колонки
--    read_at. markAllRead/markOneRead (Supabase anon-путь) продолжают работать —
--    они пишут только read_at.

ALTER TABLE notification ADD COLUMN kind text NOT NULL DEFAULT '';
ALTER TABLE notification ADD COLUMN dedup_key text;

-- Backfill дискриминатора для существующих строк.
UPDATE notification
SET kind = CASE
  WHEN type = 'system' THEN coalesce(data->>'kind', 'system')
  ELSE type::text
END;

-- Унифицированный атомарный дедуп. Партиальный (WHERE dedup_key IS NOT NULL) —
-- строки без ключа не ограничены (badges/referral пишутся свободно).
CREATE UNIQUE INDEX notification_user_dedup_key_uidx
  ON notification (user_id, dedup_key)
  WHERE dedup_key IS NOT NULL;

-- RLS-ужесточение: снимаем табличный UPDATE, отдаём только колонку read_at.
-- REVOKE UPDATE (без списка колонок) снимает и табличный, и колоночный грант.
REVOKE UPDATE ON notification FROM authenticated;
GRANT UPDATE (read_at) ON notification TO authenticated;
