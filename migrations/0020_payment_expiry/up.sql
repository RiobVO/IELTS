-- 0020_payment_expiry :: up
-- PENDING-платёж получает срок жизни (BRIEF §4.8): после expires_at webhook не
-- применяет устаревший чекаут (applyCompletedPayment переводит его в 'failed',
-- доступ не выдаётся). Закрывает бессрочно-применимые abandoned pending-строки
-- (упрощает reconciliation / retries / fraud-review). Nullable, без backfill —
-- старые pending-строки (expires_at NULL) трактуются как «без срока» и не
-- ломаются; новые initiatePayment ставят срок из PENDING_TTL_MS.

ALTER TABLE public.payment
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;
