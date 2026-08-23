-- 0057_annotation_payment_grant_lockdown :: down
-- No-op (паттерн 0047/0048/0056): up снимал только прод-дрейф Supabase default
-- privileges — гранты, которых НАШ контракт (0006/0013: authenticated SELECT)
-- никогда не выдавал. Возвращать нечего; ре-грант чужого дрейфа в down был бы
-- восстановлением бага.
SELECT 1;
