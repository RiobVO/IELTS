-- 0054_trial_claim :: up
-- Атомарный маркер «trial-лейн израсходован» (P6/§4.8; 2026-07-11). Заменяет
-- блокирующий pg_advisory_xact_lock в startAttempt (src/lib/exam/access.ts):
-- инвариант «один бесплатный полный тест на юзера» держит не лок + пересчёт, а
-- PRIMARY KEY(user_id) — INSERT ... ON CONFLICT (user_id) DO NOTHING сериализует
-- два конкурентных trial-старта РАЗНЫХ full-моков на row-lock ключа, без
-- удержания advisory-лока на весь transaction (важно на pgbouncer transaction
-- pooler, prepare:false — waiter advisory-лока держал server-connection пула).
--
-- ИСТОЧНИК ПРАВДЫ НЕ МЕНЯЕТСЯ: решение «trial израсходован» по-прежнему деривится
-- из attempt через hasConsumedTrial (гейт старта + runner route) и trialConsumedBy
-- (бейдж каталога). Эта таблица — ТОЛЬКО concurrency-guard: победитель INSERT
-- открывает попытку, проигравший пересверяется с hasConsumedTrial (тот и решает
-- resume|redirect). Поэтому claim физически не может дать ложный deny — только
-- отсечь двойное открытие. Клиент это состояние не читает.
--
-- content_item_id + ON DELETE CASCADE — ОСОЗНАННО: удаление теста (контент-вайп,
-- как 2026-07-10) освобождает trial, зеркаля attempt.content_item_id (тоже
-- CASCADE). Иначе claim пережил бы удалённые attempts и разошёлся бы с
-- hasConsumedTrial (та «возвращает» trial, когда attempts на удалённом тесте
-- исчезли). Abuse «дождаться удаления» не user-triggerable — тесты удаляет только
-- владелец. Альтернатива ON DELETE SET NULL + nullable колонка сохраняла бы claim
-- после вайпа, но именно это и создало бы рассинхрон claim↔hasConsumedTrial без
-- выгоды (гейт всё равно на hasConsumedTrial). См. SCHEMA_NOTES 0054.
--
-- SERVER-ONLY постура (как signup_throttle 0022 / error_log 0034): RLS on, REVOKE
-- ALL от клиентских ролей (снимает Supabase default-priv гранты новым таблицам),
-- НОЛЬ политик. Пишет/читает только owner-path (Drizzle). Таблица 37-я
-- (verify.ts APP_TABLE_COUNT 36 → 37; см. SCHEMA_NOTES.md).

CREATE TABLE trial_claim (
  -- PK(user_id) = сам инвариант «один trial на юзера»: конкурентный INSERT
  -- второго full-мока упрётся в этот ключ и получит ON CONFLICT DO NOTHING.
  user_id         uuid PRIMARY KEY REFERENCES profile (id) ON DELETE CASCADE,
  -- На каком тесте trial потрачен: провенанс + привязка времени жизни claim к
  -- тесту через CASCADE (удалили тест → claim ушёл, как и его attempts).
  content_item_id uuid NOT NULL REFERENCES content_item (id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now()
);
-- FK-индекс content_item_id: cascade-delete при удалении теста без seq-scan
-- (user_id уже покрыт PK слева) — паттерн mistake_resolution/saved_word.
CREATE INDEX trial_claim_content_item_id_idx ON trial_claim (content_item_id);

ALTER TABLE trial_claim ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON trial_claim FROM anon, authenticated, PUBLIC;
GRANT ALL ON trial_claim TO service_role;

-- Backfill: по одной строке на юзера из существующих attempts, по семантике
-- hasConsumedTrial — самая ранняя (по started_at) попытка на full_reading/
-- full_listening с tier_required != 'basic'. DISTINCT ON гарантирует одну строку
-- на юзера; ON CONFLICT DO NOTHING делает шаг идемпотентным (safe re-run). На
-- проде после вайпа 2026-07-10, скорее всего, пусто — но корректность обязательна.
INSERT INTO trial_claim (user_id, content_item_id, created_at)
SELECT DISTINCT ON (a.user_id)
  a.user_id, a.content_item_id, a.started_at
FROM attempt a
JOIN content_item ci ON ci.id = a.content_item_id
WHERE ci.category IN ('full_reading', 'full_listening')
  AND ci.tier_required <> 'basic'
ORDER BY a.user_id, a.started_at ASC
ON CONFLICT (user_id) DO NOTHING;
