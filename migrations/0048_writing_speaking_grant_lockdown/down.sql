-- 0048_writing_speaking_grant_lockdown :: down
-- No-op: up снимал только прод-дрейф Supabase default privileges — гранты, которых НАШ
-- контракт никогда не выдавал. Контрактная выдача этим 7 таблицам — ровно SELECT для
-- authenticated (0023/0027); INSERT/UPDATE/DELETE были явно сняты 0024/0028, а
-- REFERENCES/TRIGGER/TRUNCATE и остаток у anon вообще не выдавались нами (чистый дрейф).
-- Итоговое контрактное состояние (authenticated: SELECT; anon: ничего) up'ом не менялось,
-- возвращать нечего. Ре-грант чужого дрейфа в down был бы восстановлением бага (прецедент
-- 0047).
SELECT 1;
