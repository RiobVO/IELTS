-- 0052_preorder :: up
-- Pre-order с early-bird ценой (трек роста, этап 6; 2026-07-11). ЕДИНСТВЕННАЯ
-- additive-таблица: durable-фиксация намерения купить тариф со скидкой, пока
-- merchant-ключей нет и реального биллинга не существует. НАМЕРЕННО отдельная от
-- payment: та жёстко завязана на provider/tx-идемпотентность и webhook-lifecycle
-- (стаб-tx через UNIQUE-констрейнт размывал бы инвариант «payment = реальный
-- charge»). Никакого гранта тира эта таблица не даёт — только учёт.
-- amount — early-bird цена в тийинах, зафиксированная на момент записи (источник —
-- plans.ts, клиент сумму не диктует).
--
-- RLS-постура зеркалит saved_word/sprint_signup (per-user owner-стейт): запись
-- ТОЛЬКО серверным экшеном; у клиентских ролей — только SELECT своих строк.
-- Таблица 36-я (см. SCHEMA_NOTES.md).

CREATE TABLE preorder (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES profile (id) ON DELETE CASCADE,
  tier          user_tier NOT NULL,
  period_months integer NOT NULL,
  amount        integer NOT NULL,
  currency      text NOT NULL DEFAULT 'UZS',
  created_at    timestamptz NOT NULL DEFAULT now(),
  -- Одна запись на (user, план): повторный клик идемпотентен (ON CONFLICT DO
  -- NOTHING). Leftmost user_id обслуживает owner-read и RLS-политику.
  CONSTRAINT preorder_user_plan_key UNIQUE (user_id, tier, period_months)
);

ALTER TABLE preorder ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON preorder FROM anon, authenticated, PUBLIC;
GRANT SELECT ON preorder TO authenticated;
GRANT ALL ON preorder TO service_role;
CREATE POLICY preorder_select_own ON preorder
  FOR SELECT TO authenticated USING (user_id = auth.uid());
