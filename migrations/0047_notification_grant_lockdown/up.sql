-- 0047_notification_grant_lockdown :: up
-- Прод-дрейф Supabase default privileges (SCHEMA_NOTES, готча «default-priv grants»):
-- notification родилась в 0001 ДО принятия постуры «REVOKE ALL + явные гранты», и на
-- проде anon/authenticated унаследовали широкие табличные гранты (вплоть до TRUNCATE).
-- Реальный барьер держит RLS (anon без политик = deny-all; INSERT/DELETE у
-- authenticated без политик мертвы), но постура должна быть secure-by-default:
-- клиенту остаются только SELECT (policy-scoped, 0001) и UPDATE(read_at) (0046).
-- На локальной БД лишних грантов нет — REVOKE идемпотентно схлопывается в no-op.
REVOKE ALL ON notification FROM anon;
REVOKE INSERT, DELETE, REFERENCES, TRIGGER, TRUNCATE ON notification FROM authenticated;
