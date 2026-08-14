-- 0047_notification_grant_lockdown :: down
-- No-op: up снимал только прод-дрейф Supabase default privileges — гранты, которых
-- НАШ контракт (0001 + 0046) никогда не выдавал. Возвращать нечего: контрактное
-- состояние после 0046 (authenticated: SELECT + UPDATE(read_at); anon: ничего)
-- up'ом не менялось. Ре-грант чужого дрейфа в down был бы восстановлением бага.
SELECT 1;
