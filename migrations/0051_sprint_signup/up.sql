-- 0051_sprint_signup :: up
-- Пилот когорты «спринт к экзамену» (трек роста, этап 5; 2026-07-11). ЕДИНСТВЕННАЯ
-- additive-таблица: запись пользователя в ручную когорту (куратор — владелец,
-- никакой автоматизации). Смысл in-app записи вместо Google-формы — связка
-- user_id ↔ участие, без которой retention-эффект пилота не измерить по продукту.
-- Снапшоты exam_date/target_band фиксируют состояние на момент записи.
--
-- RLS-постура зеркалит saved_word/mistake_resolution (per-user owner-стейт):
-- запись ТОЛЬКО серверным экшеном (Drizzle owner-path); у клиентских ролей нет
-- INSERT/UPDATE/DELETE — только SELECT своих строк. Гранты secure-by-default
-- (REVOKE ALL, затем точечный GRANT SELECT). Таблица 35-я (см. SCHEMA_NOTES.md).

CREATE TABLE sprint_signup (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- UNIQUE: пилот — одна когорта, одна запись на пользователя (идемпотентность
  -- ON CONFLICT DO NOTHING в экшене). Leftmost user_id обслуживает owner-read и RLS.
  user_id         uuid NOT NULL UNIQUE REFERENCES profile (id) ON DELETE CASCADE,
  -- Telegram-хэндл для связи куратора с участником (когорта живёт в Telegram).
  telegram_handle text NOT NULL,
  -- Снапшоты на момент записи (профиль может меняться, когорта собрана по этим).
  exam_date       date,
  target_band     numeric(2, 1),
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE sprint_signup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sprint_signup FROM anon, authenticated, PUBLIC;
GRANT SELECT ON sprint_signup TO authenticated;
GRANT ALL ON sprint_signup TO service_role;
CREATE POLICY sprint_signup_select_own ON sprint_signup
  FOR SELECT TO authenticated USING (user_id = auth.uid());
