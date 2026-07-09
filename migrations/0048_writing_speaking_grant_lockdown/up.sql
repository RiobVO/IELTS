-- 0048_writing_speaking_grant_lockdown :: up
-- Прод-дрейф Supabase default privileges (SCHEMA_NOTES, готча «default-priv grants»),
-- тот же класс, что закрыла 0047 для notification. Хардинг Writing/Speaking (0024/0028)
-- ревокал у authenticated INSERT/UPDATE/DELETE точечно, НЕ через REVOKE ALL — поэтому
-- унаследованные от Supabase default-priv гранты REFERENCES/TRIGGER/TRUNCATE на этих 7
-- таблицах остались висеть. Барьер держит RLS (owner-read политики select_own; писать
-- может только owner-path), но постура должна быть secure-by-default: TRUNCATE особенно
-- опасен — он НЕ фильтруется RLS и сносит всю таблицу разом.
-- Контракт (0023/0027 + 0024/0028) оставляет клиенту ровно SELECT (policy-scoped) —
-- его не трогаем. Ниже: REVOKE ALL у anon (страховка, там и так пусто после 0024/0028)
-- + снятие лишнего у authenticated. На локальной БД дрейфа нет — REVOKE идемпотентно
-- схлопывается в no-op.
REVOKE ALL ON writing_task       FROM anon;
REVOKE ALL ON writing_submission FROM anon;
REVOKE ALL ON writing_feedback   FROM anon;
REVOKE ALL ON speaking_task        FROM anon;
REVOKE ALL ON speaking_submission  FROM anon;
REVOKE ALL ON speaking_feedback    FROM anon;
REVOKE ALL ON speaking_audio_event FROM anon;

REVOKE INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE ON writing_task       FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE ON writing_submission FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE ON writing_feedback   FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE ON speaking_task        FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE ON speaking_submission  FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE ON speaking_feedback    FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE ON speaking_audio_event FROM authenticated;
