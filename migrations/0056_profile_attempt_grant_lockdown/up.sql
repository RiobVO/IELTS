-- 0056_profile_attempt_grant_lockdown :: up
-- Прод-дрейф Supabase default privileges (SCHEMA_NOTES, готча «default-priv grants»),
-- пойман read-only постура-скриптом волны 1.5 (scripts/check-rls-posture.ts):
-- anon держал ВСЕ табличные привилегии на profile/attempt (вплоть до TRUNCATE),
-- authenticated — DELETE/REFERENCES/TRIGGER/TRUNCATE сверх SELECT. 0010 ревокал
-- только INSERT/UPDATE у authenticated — DELETE и служебные привилегии остались
-- за кадром. Эксплуатации не было: RLS включён, DELETE-политики нет ни у кого,
-- anon-политики ownership-scoped (auth.uid() = null → 0 строк). Но постура
-- обязана быть secure-by-default, как у соседей (0047 notification, 0048 W/S):
-- клиенту остаётся только SELECT (policy-scoped, 0001). Все app-записи в
-- profile/attempt идут owner-path (Drizzle). На локальной БД лишних грантов
-- нет — REVOKE идемпотентно схлопывается в no-op (INSERT/UPDATE у authenticated
-- повторяют 0010 ради явного конечного состояния «всё, кроме SELECT»).
REVOKE ALL ON profile FROM anon;
REVOKE ALL ON attempt FROM anon;
REVOKE INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE ON profile FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE ON attempt FROM authenticated;
