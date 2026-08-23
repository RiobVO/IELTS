-- 0056_profile_attempt_grant_lockdown :: down
-- No-op (паттерн 0047/0048): up снимал только прод-дрейф Supabase default
-- privileges — гранты, которых НАШ контракт (0000/0001 + write-lockdown 0010)
-- никогда не выдавал. Возвращать нечего: контрактное состояние (anon: ничего;
-- authenticated: SELECT policy-scoped) up'ом не менялось. Ре-грант чужого
-- дрейфа в down был бы восстановлением бага.
SELECT 1;
