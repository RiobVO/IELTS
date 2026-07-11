-- 0054_trial_claim :: down
-- Полный реверт: политик нет, enum'ов не заводилось. Данные-маркеры производные
-- (деривятся из attempt) — восстановимы повторным backfill'ом при re-up. Trial-
-- лейн откатывается к advisory-lock-варианту startAttempt (код прежней ревизии).
DROP TABLE IF EXISTS trial_claim;
